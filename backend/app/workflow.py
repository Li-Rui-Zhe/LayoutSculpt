"""LangGraph 管理节点与检查点，LangChain 组合提示词、所选 AI 来源与结构解析器。"""

import asyncio
import json
import operator
import time
from contextlib import nullcontext
from typing import Annotated, TypedDict

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph
from PIL import Image

from .ai_cache import StageCache, compact_json, read_metrics, record_metric
from .ai_contracts import (
    LayoutReviewPatch,
    apply_review_patch,
)
from .ai_failures import ai_failure_message, classify_ai_error
from .ai_requests import asset_input, furnishing_schema, layout_input, review_schema
from .asset_selection import select_candidates
from .architecture import structure_issues, validate_generated_structure
from .codex import CodexChatModel, CodexClient, CodexError
from .consistency import matches_confirmation, source_hash, structure_hash
from .modeling import build_model
from .public_errors import public_message
from .input_quality import SourceImageRejected
from .recognition_contract import RecognitionExtraction, validate_recognition
from .recognition_checkpoint import (
    RecognitionCheckpoint, checkpoint_candidate, save_checkpoint, validation_summary,
)
from .source_evidence import (
    PixelLayoutExtraction, SourceEvidence, alignment_from_evidence, compare_source,
    detail_views, image_wall_findings, pixel_wire, update_comparison, validate_evidence,
)
from .quality import finish_design, prepare_generated_furnishing
from .recovery import REVIEW_TIMEOUT_WARNING
from .resilience import transient_ai_error
from .schemas import (
    CustomStyleFurnishing,
    Furnishing,
    Layout,
    signed_area,
    validate_furnishing,
)


class State(TypedDict, total=False):
    job_id: str
    options: dict
    layout: dict
    furniture: dict
    agents: Annotated[list[dict], operator.add]
    result: dict
    rebuild_of: str
    edited_of: str
    refine_of: str
    restructure_of: str
    preserve_design: bool
    imported_project: bool
    confirmed_structure: bool
    awaiting_review: bool
    confirmation: dict
    ai_review: dict
    recovered_structure_of: str
    source_sha256: str
    furnishing_status: str
    style_scheme: dict
    render_style: str
    recognition_review: dict
    source_alignment: dict
    source_evidence: dict
    reidentify_of: str


def create_graph(
    settings,
    store,
    client,
    registry,
    checkpointer,
    model_builder=build_model,
    library=None,
):
    cache = StageCache(settings.data_dir / "ai-cache")

    async def run_agent(
        state,
        role,
        skill,
        output_type,
        payload,
        post_validate=None,
        artifact=None,
        transform=None,
        reference_images=None,
    ):
        job_id = state["job_id"]
        workspace = settings.workspace(job_id)
        input_digest = source_hash(workspace / "source.png")
        if state.get("source_sha256") and state["source_sha256"] != input_digest:
            raise CodexError("原图在处理期间发生变化，请重新上传后识别")
        instructions, skills = registry.compose("floorplan-contract", skill)
        (workspace / f"{role}-skills.md").write_text(instructions, encoding="utf-8")
        trace = {
            "role": role,
            "skills": skills,
            "threads": [],
            "model": state["options"].get("model"),
            "reasoning_effort": state["options"].get("reasoning_effort"),
            "cache_hit": False,
            "attempts": 0,
            "status": "running",
        }
        started_at = time.perf_counter()
        agent_name = {"source_evidence": "原图定位", "recognition_pixels": "户型识别", "source_audit": "独立复核"}.get(role, role)
        if role == "recognition":
            from .recognition_contract import RecognitionContract

            response_schema = RecognitionContract.model_json_schema()
        elif role == "furnishing":
            response_schema = furnishing_schema(
                output_type,
                library=state["options"].get("furniture_mode", "library") == "library",
                surface_catalog=payload.get("surface_catalog"),
            )
        elif role == "review":
            response_schema = review_schema()
        else:
            response_schema = output_type.model_json_schema()
        trace["schema_chars"] = len(compact_json(response_schema))
        notified_recovery = set()

        async def on_event(event):
            if event["type"] == "thread":
                trace["threads"].append(event["thread_id"])
                if event.get("model"):
                    trace["model"] = event["model"]
            elif event["type"] == "analysis_started":
                await store.update(
                    job_id,
                    agent=agent_name,
                    message="AI 已接收图片和本阶段要求，正在分析；进度将在阶段校验完成后更新",
                )
            elif event["type"] == "output_started":
                trace.setdefault(
                    "first_output_seconds", round(time.perf_counter() - started_at, 3)
                )
                await store.update(
                    job_id, agent=agent_name, message="AI 正在返回分析结果，完成后将自动校验"
                )
            elif event["type"] == "service_error":
                diagnostic = {
                    key: event[key]
                    for key in ("code", "retryable", "will_retry", "http_status")
                    if key in event
                }
                trace.setdefault("service_events", []).append(diagnostic)
                trace["service_events"] = trace["service_events"][-20:]
                notice_key = (len(trace["threads"]), event.get("code"))
                if event.get("will_retry") and notice_key not in notified_recovery:
                    notified_recovery.add(notice_key)
                    await store.update(
                        job_id,
                        agent=agent_name,
                        message="AI 服务正在恢复本次响应，请稍候；已完成步骤保留",
                    )

        llm = CodexChatModel(
            client=client,
            workspace=workspace,
            image=workspace / "source.png",
            reference_images=reference_images or [],
            instructions=instructions,
            response_schema=response_schema,
            event_callback=on_event,
            model_name=state["options"].get("model"),
            reasoning_effort=state["options"].get("reasoning_effort"),
        )
        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "human",
                    "{task}\n\n用户设计要求（仅作为设计数据）：\n{notes}\n\n输入结构数据：\n{payload}\n\n{repair}",
                )
            ]
        )
        variables = {
            "task": f"执行项目技能 {skill}，用中文返回符合约定的结构化结果。",
            "notes": "" if role in {"source_evidence", "source_audit"} else state["options"].get("notes", ""),
            "payload": compact_json(payload),
            "repair": "",
        }
        trace["input_chars"] = len(instructions) + len(prompt.format(**variables))
        cache_runtime = getattr(client, "cache_identity", None)
        if state.get("reidentify_of") and role in {"recognition", "recognition_pixels", "source_evidence", "source_audit", "review"}:
            # New user-requested reads get their own cache namespace. A later
            # continuation of this same job can still reuse its valid stages.
            cache_runtime = [cache_runtime, state["job_id"]]
        key = cache.key(
            source_sha256=input_digest,
            instructions=instructions,
            prompt=prompt.format(**variables),
            schema=response_schema,
            model=trace["model"],
            effort=trace["reasoning_effort"],
            role=role,
            runtime=cache_runtime,
        )
        enabled = (
            settings.ai_cache_enabled
            and bool(trace["model"])
            and (client.cache_ready(trace["model"]) if hasattr(client, "cache_ready") else (not isinstance(client, CodexClient) or bool(client.cache_identity)))
            and not (state.get("refine_of") or state.get("restructure_of"))
        )

        def validate(output):
            if source_hash(workspace / "source.png") != input_digest:
                raise CodexError("AI 分析期间原图发生变化，禁止复用或继续生成")
            # Normalize typed defaults before persistence; JSON reloads must
            # not change geometry hashes (default 0 vs explicitly typed 0.0).
            output = output_type.model_validate_json(output.model_dump_json())
            if transform:
                output = transform(output)
            if post_validate:
                post_validate(output)
            return output

        def save(output):
            (workspace / f"{artifact or role}.json").write_text(
                output.model_dump_json(indent=2), encoding="utf-8"
            )
            trace.update(status="validated", output_chars=len(output.model_dump_json()))
            return output.model_dump(), trace

        recognition_attempts = []
        recognition_candidate = None
        try:
            async with (
                asyncio.timeout(settings.codex_timeout),
                cache.lock(key) if enabled else nullcontext(),
            ):
                cached = await asyncio.to_thread(cache.read, key) if enabled else None
                if cached is not None:
                    try:
                        output = validate(output_type.model_validate(cached))
                    except (ValueError, TypeError):
                        trace["cache_rejected"] = True
                    else:
                        trace["cache_hit"] = True
                        await store.update(
                            job_id,
                            agent=agent_name,
                            message="复用相同输入的已校验结果，正在完成本次校验",
                        )
                        return save(output)
                chain = prompt | llm | PydanticOutputParser(pydantic_object=output_type)

                async def invoke_model():
                    while True:
                        try:
                            trace["requests"] = trace.get("requests", 0) + 1
                            return await chain.ainvoke(variables)
                        except (CodexError, ConnectionError, TimeoutError) as exc:
                            temporary = transient_ai_error(exc) or (
                                role == "recognition" and isinstance(exc, TimeoutError)
                            )
                            remaining = settings.codex_timeout - (
                                time.perf_counter() - started_at
                            )
                            if (
                                not temporary
                                or trace.get("connection_retries", 0) >= 1
                                or remaining < 15
                            ):
                                raise
                            trace["connection_retries"] = 1
                            failure = classify_ai_error(exc)
                            trace.setdefault("retries", []).append(failure)
                            delay = 5 if failure["code"] == "rate_limited" else 1
                            await store.update(
                                job_id,
                                agent=agent_name,
                                message=(
                                    "AI 未返回有效结果，正在重新请求一次；已完成步骤保留"
                                    if failure["code"] == "empty_response"
                                    else "AI 服务暂时不可用，稍后自动重试一次；已完成步骤保留"
                                ),
                            )
                            await asyncio.sleep(delay)

                for attempt in range(2):
                    output = None
                    trace["attempts"] += 1
                    try:
                        output = await invoke_model()
                        output = validate(output)
                        if enabled:
                            try:
                                await asyncio.to_thread(
                                    cache.write, key, output.model_dump()
                                )
                            except OSError:
                                trace["cache_write_unavailable"] = True
                        return save(output)
                    except Exception as exc:
                        from langchain_core.exceptions import OutputParserException

                        if role in {"recognition", "recognition_pixels"} and isinstance(exc, (ValueError, OutputParserException)) and not isinstance(exc, SourceImageRejected):
                            recognition_attempts.append({"attempt": attempt + 1, "issues": validation_summary(exc)})
                            if output is not None:
                                recognition_candidate = output.model_dump()
                            if attempt and recognition_candidate is not None:
                                raise RecognitionCheckpoint(recognition_candidate, recognition_attempts, trace) from exc
                        if (
                            not isinstance(exc, (ValueError, OutputParserException))
                            or attempt
                        ):
                            if isinstance(exc, (ValueError, OutputParserException)):
                                trace["failure"] = {
                                    "code": "invalid_result",
                                    "retryable": False,
                                }
                            raise
                        (workspace / f"{role}-validation.txt").write_text(
                            str(exc)
                            + (
                                "\n\n" + output.model_dump_json(indent=2)
                                if output is not None
                                else ""
                            ),
                            encoding="utf-8",
                        )
                        variables["repair"] = (
                            f"上次结果未通过校验，按同一 outputSchema 修正；只修改有依据的问题。错误：{str(exc)[:2400]}"
                        )
                        if output is not None:
                            variables["repair"] += (
                                "\n待修正结果：\n" + output.model_dump_json()
                            )
                        await store.update(
                            job_id, message="校验发现问题，正在修正一次", agent=agent_name
                        )
        except asyncio.CancelledError:
            trace["status"] = "cancelled"
            raise
        except Exception as exc:
            if (role in {"recognition", "recognition_pixels"} and recognition_candidate is not None
                    and isinstance(exc, (TimeoutError, CodexError, ConnectionError))
                    and source_hash(workspace / "source.png") == input_digest):
                recognition_attempts.append({"attempt": len(recognition_attempts) + 1,
                    "issues": ["修正请求未能完成，已保留上一次可显示的平面图；请检查连接后重试，或先查看并调整。"]})
                trace["status"] = "needs_review"
                trace["failure"] = classify_ai_error(exc)
                raise RecognitionCheckpoint(recognition_candidate, recognition_attempts, trace) from exc
            if isinstance(exc, RecognitionCheckpoint):
                trace["status"] = "needs_review"
                trace["failure"] = {"code": "invalid_result", "retryable": False}
                raise
            trace["status"] = "timed_out" if isinstance(exc, TimeoutError) else "failed"
            if isinstance(exc, SourceImageRejected):
                trace["status"] = "input_rejected"
                trace["failure"] = {"code": "input_image_rejected", "retryable": False}
            trace.setdefault("failure", classify_ai_error(exc))
            # 限定为阶段名和安全分类；详细上游响应不写入公开任务数据。
            if trace["failure"]["code"] == "invalid_result":
                from .ai_failures import MESSAGES

                label = {
                    "recognition": "户型识别",
                    "recognition_pixels": "房间与门窗识别",
                    "source_evidence": "原图轮廓定位",
                    "source_audit": "原图独立复核",
                    "review": "结构复核",
                    "furnishing": "家具规划",
                }.get(role, "AI 生成")
                raise ValueError(
                    f"{label}：{MESSAGES['invalid_result']}原图和已完成步骤已保留。"
                ) from exc
            raise
        finally:
            trace["elapsed_seconds"] = round(time.perf_counter() - started_at, 3)
            record_metric(workspace, {k: v for k, v in trace.items() if k != "skills"})

    async def recognize(state):
        if state["options"].get("recognition_mode") == "precise":
            return await recognize_precise(state)
        await store.update(
            state["job_id"],
            stage="识别户型结构",
            progress=12,
            agent="户型识别",
            message="正在检查原图可用性，并读取房间、墙体及门窗",
        )
        try:
            extracted, trace = await run_agent(
                state, "recognition", "floorplan-recognition", RecognitionExtraction,
                {"task": "依据原图识别实际结构，保持原图朝向、比例和全部可辨认墙体门窗"},
                validate_recognition, artifact="recognition-wire",
            )
        except RecognitionCheckpoint as checkpoint:
            layout, review = checkpoint_candidate(checkpoint.candidate, checkpoint.attempts)
            await store.update(state["job_id"], message=review["message"], agent="户型识别")
            return {"layout": layout, "recognition_review": review, "agents": [checkpoint.trace]}
        workspace = settings.workspace(state["job_id"])
        layout = validate_recognition(RecognitionExtraction.model_validate(extracted)).model_dump()
        (workspace / "recognition.json").write_text(
            json.dumps(layout, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (workspace / "recognition-meta.json").write_text(
            json.dumps(
                {
                    "source_sha256": source_hash(workspace / "source.png"),
                    "structure_hash": structure_hash(layout),
                }
            ),
            encoding="utf-8",
        )
        return {"layout": layout, "agents": [trace]}

    async def recognize_precise(state):
        workspace = settings.workspace(state["job_id"])
        source = workspace / "source.png"
        with Image.open(source) as image:
            size = image.size
        await store.update(state["job_id"], stage="定位原图轮廓与墙线", progress=8,
                           message="先沿真实墙线读取外轮廓、凹口与尺寸，不根据房间名称补墙", agent="原图定位")
        evidence_data, evidence_trace = await run_agent(
            state, "source_evidence", "floorplan-source-evidence", SourceEvidence,
            {"image_size": list(size), "task": "独立读取原图像素证据；当前没有任何候选结构"},
            lambda output: validate_evidence(output, size),
        )
        evidence = SourceEvidence.model_validate(evidence_data)
        alignment = alignment_from_evidence(evidence, size)
        alignment["source_sha256"] = source_hash(source)
        images, views = await asyncio.to_thread(detail_views, source, workspace, evidence)
        alignment["views"] = views
        await store.update(state["job_id"], stage="细读房间与门窗", progress=12,
            message=f"已定位建筑轮廓，结合整图{'和 ' + str(len(images)) + ' 张局部图' if images else ''}读取房间与门窗，再由程序统一换算尺寸", agent="户型识别")

        def meters(output):
            return validate_recognition(RecognitionExtraction.model_validate(pixel_wire(output, alignment)))

        checkpoint = None
        try:
            pixels, trace = await run_agent(
                state, "recognition_pixels", "floorplan-pixel-recognition", PixelLayoutExtraction,
                {"image_size": list(size), "source_evidence": evidence_data, "image_views": views,
                 "meters_per_pixel": alignment["meters_per_pixel"], "task": "固定建筑骨架，再划分净空房间和安装门窗；所有二维点使用整图像素坐标"},
                meters, artifact="recognition-pixels", reference_images=images,
            )
            layout = meters(PixelLayoutExtraction.model_validate(pixels)).model_dump()
        except RecognitionCheckpoint as failure:
            wire = pixel_wire(PixelLayoutExtraction.model_validate(failure.candidate), alignment)
            layout, checkpoint = checkpoint_candidate(wire, failure.attempts)
            trace = failure.trace
        if not checkpoint or checkpoint["can_continue"]:
            alignment = update_comparison(alignment, compare_source(layout, evidence, alignment))
            alignment["image_findings"] = await asyncio.to_thread(image_wall_findings, source, layout, alignment)
            alignment["findings"].extend(alignment["image_findings"])
            (workspace / "recognition.json").write_text(json.dumps(layout, ensure_ascii=False), encoding="utf-8")
            (workspace / "recognition-meta.json").write_text(json.dumps({"source_sha256": source_hash(source), "structure_hash": structure_hash(layout)}), encoding="utf-8")
        layout["warnings"] = list(dict.fromkeys(layout["warnings"] + alignment["warnings"]))[:30]
        (workspace / "source-alignment.json").write_text(json.dumps(alignment, ensure_ascii=False), encoding="utf-8")
        result = {"layout": layout, "source_alignment": alignment, "source_evidence": evidence_data,
                  "agents": [evidence_trace, trace]}
        if checkpoint:
            result["recognition_review"] = checkpoint
        elif any(f["blocking"] for f in alignment["findings"]):
            result["ai_review"] = {"status": "needs_review", "message": "原图证据与当前识别存在差异，请先检查平面图。"}
        return result

    async def review(state):
        if state.get("source_alignment") and state["options"].get("recognition_mode") == "precise":
            return await independent_review(state)
        await store.update(
            state["job_id"],
            stage="复核空间关系",
            progress=40,
            agent="空间复核",
            message="独立 Agent 正在对照原图检查结构",
        )
        candidate = Layout.model_validate(state["layout"])
        payload = {
            "base_revision": structure_hash(candidate),
            "layout": layout_input(candidate),
            "local_findings": structure_issues(candidate),
        }
        try:
            async with asyncio.timeout(
                min(settings.review_timeout, settings.codex_timeout)
            ):
                patch, trace = await run_agent(
                    state,
                    "review",
                    "floorplan-review",
                    LayoutReviewPatch,
                    payload,
                    lambda proposed: apply_review_patch(candidate, proposed),
                    artifact="review-patch",
                )
        except (TimeoutError, ValueError, CodexError, ConnectionError) as exc:
            if isinstance(
                exc, (CodexError, ConnectionError)
            ) and not transient_ai_error(exc):
                raise
            # No partial review output is accepted. Human confirmation remains mandatory.
            validate_generated_structure(candidate)
            status = "timed_out" if isinstance(exc, TimeoutError) else "incomplete"
            warning = (
                REVIEW_TIMEOUT_WARNING
                if status == "timed_out"
                else "AI 复核连接暂时不可用，已保留识别结构，请对照原图人工核对后继续。"
                if transient_ai_error(exc)
                else "AI 复核的修改建议未通过校验，已保留原识别结构。请对照原图人工核对，未应用无效修改。"
            )
            if len(candidate.warnings) < 30 and warning not in candidate.warnings:
                candidate.warnings.append(warning)
            await store.update(state["job_id"], agent="空间复核", message=warning)
            return {
                "layout": candidate.model_dump(),
                "ai_review": {
                    "status": status,
                    "message": warning,
                },
            }
        layout = apply_review_patch(candidate, patch)
        (settings.workspace(state["job_id"]) / "review.json").write_text(
            layout.model_dump_json(indent=2), encoding="utf-8"
        )
        return {
            "layout": layout.model_dump(),
            "agents": [trace],
            "ai_review": {
                "status": "completed",
                "method": "validated_patch",
                "summary": patch["summary"],
            },
        }

    async def independent_review(state):
        workspace = settings.workspace(state["job_id"])
        size = (state["source_alignment"]["image_width"], state["source_alignment"]["image_height"])
        await store.update(state["job_id"], stage="独立对照原图", progress=40,
            message="复核先独立读图，再比较外轮廓、卧室数量与房间位置；不会把几何通过当作还原准确", agent="原图复核")
        try:
            views = state["source_alignment"].get("views", [])
            images = [workspace / f"recognition-detail-{i + 1}.png" for i in range(len(views))]
            if not all(path.is_file() for path in images):
                views, images = [], []
            async with asyncio.timeout(min(settings.review_timeout, settings.codex_timeout)):
                audit_data, trace = await run_agent(
                    state, "source_audit", "floorplan-source-evidence", SourceEvidence,
                    {"image_size": list(size), "image_views": views, "task": "独立读取原图像素证据；不参考之前的识别结果或结论。第一张是整图，局部图按 image_views 对应裁切矩形，局部点需加左上角回到整图。所有输出仍用整图像素坐标。"},
                    lambda output: validate_evidence(output, size), reference_images=images,
                )
            audit = SourceEvidence.model_validate(audit_data)
            alignment = update_comparison(state["source_alignment"], compare_source(state["layout"], audit, state["source_alignment"]), independent=True)
            alignment["findings"].extend(alignment.get("image_findings", []))
            audit_scale = alignment_from_evidence(audit, size)
            if audit.dimensions and abs(audit_scale["meters_per_pixel"] / alignment["meters_per_pixel"] - 1) > 0.12:
                alignment["findings"].append({"code": "dimension_disagreement", "message": "两次独立读图得到的尺寸比例不一致，请先核对尺寸。", "blocking": True})
            alignment["audit_outline"] = audit.outline_px
            issues = [f["message"] for f in alignment["findings"]]
            needs_confirmation = any(f["blocking"] for f in alignment["findings"])
            report = {"status": "needs_review" if needs_confirmation else "completed", "method": "independent_source_comparison",
                      "summary": "；".join(issues) if issues else "已完成独立读图对照，未发现达到提示阈值的结构差异；仍建议查看原图叠加结果。"}
            if needs_confirmation:
                report["message"] = "独立读图与当前结果存在差异，请先检查平面图，再决定是否继续。"
            agents = [trace]
        except (TimeoutError, ValueError, CodexError, ConnectionError, SourceImageRejected):
            alignment = state["source_alignment"]
            report = {"status": "incomplete", "method": "independent_source_comparison", "message": "独立读图复核未完成，识别结果已保留，请先查看平面图后继续。"}
            agents = []
        (workspace / "source-alignment.json").write_text(json.dumps(alignment, ensure_ascii=False), encoding="utf-8")
        return {"source_alignment": alignment, "ai_review": report, "agents": agents}

    async def furnish(state):
        await store.update(
            state["job_id"],
            stage="规划家具布置",
            progress=58,
            agent="家具规划",
            message="正在安排家具，并检查房间边界",
        )
        layout = Layout.model_validate(state["layout"])
        asset_items = []
        if state["options"].get("furniture_mode", "library") == "library":
            catalog = json.loads(settings.furniture_catalog.read_text(encoding="utf-8"))
            asset_items = [
                {**item, "catalog_kind": item["kind"]}
                for item in catalog["items"]
            ]
            if library:
                asset_items = await library.catalog(for_ai=True)
            available_count = len(asset_items)
            asset_items = select_candidates(
                asset_items, layout, state["options"]["style"],
                state["options"].get("notes", "") + " " + state["options"].get("style_description", ""),
            )
            (settings.workspace(state["job_id"]) / "furnishing-candidates.json").write_text(
                json.dumps({"available": available_count, "selected": len(asset_items),
                            "style": state["options"]["style"], "items": asset_input(asset_items)},
                           ensure_ascii=False, indent=2), encoding="utf-8",
            )
        allowed_assets = {
            item["asset_id"]: item for item in asset_items if "asset_id" in item
        }
        custom_style = state["options"].get("style") == "custom"
        style_context = {}
        if custom_style:
            from .surface_materials import FLOOR_MATERIALS, MATERIALS, WALL_MATERIALS
            from .texture_assets import available_textures

            textures = (await asyncio.to_thread(available_textures, settings))["items"]
            surface_catalog = {
                "walls": [MATERIALS[key] for key in WALL_MATERIALS],
                "floor": [MATERIALS[key] for key in FLOOR_MATERIALS],
            }
            for item in textures:
                for category in item.get("categories", ["walls", "floor"]):
                    if category in surface_catalog:
                        surface_catalog[category].append(
                            {
                                "id": item["id"],
                                "name": item["name"],
                                "family": item["family"],
                                "finish": item["finish"],
                            }
                        )

            style_context = {
                "style_description": state["options"]["style_description"],
                "surface_catalog": surface_catalog,
                "selected_wall_material": state["options"].get("wall_material"),
                "selected_floor_material": state["options"].get("floor_material"),
            }

        def validate_plan(plan):
            validate_furnishing(plan, layout)
            if custom_style:
                for field, category in [
                    ("wall_material", "walls"),
                    ("floor_material", "floor"),
                ]:
                    if getattr(plan, field) not in {
                        entry["id"] for entry in surface_catalog[category]
                    }:
                        raise ValueError(
                            "饰面不在本次用途对应的材质目录中，请从提供的目录选择"
                        )
            for item in plan.items:
                if item.asset_id and (
                    item.asset_id not in allowed_assets
                    or item.kind != allowed_assets[item.asset_id]["kind"]
                ):
                    raise ValueError(
                        "家具素材 ID 或类型不在本次目录中，请使用目录提供的 asset_id 和 kind"
                    )

        try:
            furniture, trace = await run_agent(
                state,
                "furnishing",
                "furniture-planning",
                CustomStyleFurnishing if custom_style else Furnishing,
                {
                    "layout": layout_input(layout),
                    "style": state["options"]["style"],
                    "furniture_assets": asset_input(asset_items),
                    **style_context,
                },
                validate_plan,
                transform=lambda plan: prepare_generated_furnishing(plan, layout),
            )
        except (TimeoutError, ValueError, CodexError, ConnectionError) as exc:
            if isinstance(
                exc, (CodexError, ConnectionError)
            ) and not transient_ai_error(exc):
                raise
            reason = (
                "超时"
                if isinstance(exc, TimeoutError)
                else "连接暂时不可用"
                if transient_ai_error(exc)
                else "结果无法读取"
            )
            warning = f"家具规划{reason}，已先生成确认的房屋结构；家具尚未完成，可手动布置或重新规划家具。"
            if custom_style:
                warning += "自定义风格搭配尚未完成，已保留风格描述供重新规划使用。"
            await store.update(state["job_id"], agent="家具规划", message=warning)
            return {
                "furniture": {"items": [], "notes": [warning]},
                "furnishing_status": "incomplete",
                "style_scheme": {},
            }
        style_scheme = (
            {
                key: furniture.pop(key)
                for key in ("render_style", "wall_material", "floor_material")
            }
            if custom_style
            else {}
        )
        if library:
            furniture = (await library.resolve_furnishing(furniture)).model_dump()
            validate_furnishing(Furnishing.model_validate(furniture), layout)
        if not furniture["items"]:
            furniture["notes"] = [
                "本次方案未包含可放置的家具，已保留完整房屋结构，可手动补充或重新规划家具。",
                *furniture["notes"],
            ][:20]
        return {
            "furniture": furniture,
            "agents": [trace],
            "style_scheme": style_scheme,
            "furnishing_status": "completed" if furniture["items"] else "incomplete",
        }

    async def prepare_review(state):
        workspace = settings.workspace(state["job_id"])
        if state.get("source_sha256") and state["source_sha256"] != source_hash(
            workspace / "source.png"
        ):
            raise CodexError("原图在处理期间发生变化，请重新识别")
        if state.get("recognition_review"):
            return save_checkpoint(state, workspace, read_metrics(workspace))
        layout = Layout.model_validate(state["layout"])
        validate_generated_structure(layout)
        document = {**layout.model_dump(), "furniture": [], "furniture_notes": []}
        (workspace / "structure.json").write_text(
            json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (workspace / "review-seed.json").write_text(
            json.dumps({**state, "awaiting_review": False}, ensure_ascii=False),
            encoding="utf-8",
        )
        return {
            "awaiting_review": True,
            "result": {
                "title": layout.title,
                "area": round(abs(signed_area(layout.outline)), 1),
                "room_count": len(layout.rooms),
                "scale_note": layout.scale_note,
                "warnings": list(
                    dict.fromkeys(
                        layout.warnings
                        + structure_issues(layout)
                        + (
                            [state["ai_review"]["message"]]
                            if state.get("ai_review", {}).get("message")
                            else []
                        )
                    )
                ),
                "revision": structure_hash(layout),
                "ai_review": state.get("ai_review", {"status": "not_requested"}),
                **({"source_alignment_url": f"/api/jobs/{state['job_id']}/artifacts/source-alignment.json"} if state.get("source_alignment") else {}),
                "pipeline_metrics": read_metrics(workspace),
                "recovered_structure_of": state.get("recovered_structure_of"),
                "layout_url": f"/api/jobs/{state['job_id']}/artifacts/structure.json",
            },
        }

    async def build(state):
        build_started = time.perf_counter()
        await store.update(
            state["job_id"],
            stage="构建三维模型",
            progress=82,
            agent="GLB 建模",
            message="正在生成真实墙体、门窗及家具模型",
        )
        workspace = settings.workspace(state["job_id"])
        if state.get("source_sha256") and state["source_sha256"] != source_hash(workspace / "source.png"):
            raise ValueError("原图在生成期间发生变化，请重新识别")
        layout = Layout.model_validate(state["layout"])
        layout, furniture, quality = finish_design(
            layout,
            Furnishing.model_validate(state["furniture"]),
            automatic=not bool(state.get("edited_of") or state.get("preserve_design")),
        )
        if not (state.get("edited_of") or state.get("preserve_design")):
            from .surface_design import apply_generation_surfaces

            scheme = state.get("style_scheme", {})
            layout = apply_generation_surfaces(
                layout,
                {
                    "wall_material": state["options"].get("wall_material")
                    or scheme.get("wall_material"),
                    "floor_material": state["options"].get("floor_material")
                    or scheme.get("floor_material"),
                },
            )
        render_style = state["options"]["style"]
        if render_style == "custom":
            render_style = (
                state.get("style_scheme", {}).get("render_style")
                or state.get("render_style")
                or state["options"].get("render_style")
                or "natural"
            )
        confirmation = state.get("confirmation")
        if confirmation and (
            not matches_confirmation(layout, confirmation, snapshot=state["layout"])
            or confirmation["source_sha256"] != source_hash(workspace / "source.png")
        ):
            raise ValueError("生成前结构或原图发生变化，请重新确认户型结构")
        if confirmation and confirmation["structure_hash"] != structure_hash(layout):
            confirmation = {
                **confirmation,
                "legacy_structure_hash": confirmation["structure_hash"],
                "structure_hash": structure_hash(layout),
            }
        quality["furnishing_complete"] = state.get("furnishing_status") != "incomplete"
        (workspace / "quality-report.json").write_text(
            json.dumps(quality, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        furniture_report = await model_builder(
            settings,
            workspace,
            layout,
            furniture,
            render_style,
            furniture_mode=state["options"].get("furniture_mode", "library"),
        )
        if state.get("source_sha256") and state["source_sha256"] != source_hash(workspace / "source.png"):
            raise ValueError("建模期间原图发生变化，请重新识别")
        if confirmation and confirmation["source_sha256"] != source_hash(
            workspace / "source.png"
        ):
            raise ValueError("建模期间原图发生变化，请重新核对结构")
        record_metric(
            workspace,
            {
                "role": "build",
                "status": "validated",
                "cache_hit": False,
                "elapsed_seconds": round(time.perf_counter() - build_started, 3),
            },
        )
        base = f"/api/jobs/{state['job_id']}/artifacts"
        result = {
            "render_style": render_style,
            "style_scheme": state.get("style_scheme", {}),
            "style_description": state["options"].get("style_description", ""),
            "title": layout.title,
            "area": round(abs(signed_area(layout.outline)), 1),
            "room_count": len(layout.rooms),
            "confidence": layout.confidence,
            "scale_note": layout.scale_note,
            "warnings": layout.warnings + furniture.notes + quality["issues"],
            "quality": quality,
            "delivery_notice": furniture.notes[0]
            if not quality["furnishing_complete"]
            else None,
            "delivery_status": "ready"
            if quality["furnishing_complete"]
            else "structure_ready",
            "generation_policy_version": "resilient-generation-v3",
            "consistency": {
                **furniture_report.get("consistency", {}),
                "source_reviewed": bool(
                    confirmation and confirmation.get("method") == "user_review"
                ),
                "confirmation": confirmation,
                "source_sha256": source_hash(workspace / "source.png"),
            },
            "quality_url": base + "/quality-report.json",
            "consistency_url": base + "/consistency-report.json",
            "model_url": base + "/model.glb",
            "layout_url": base + "/layout.json",
            "source_url": base + "/source.png",
            **({"source_alignment_url": base + "/source-alignment.json"} if state.get("source_alignment") else {}),
            "recognition_mode": state["options"].get("recognition_mode", "fast"),
            "agents": state.get("agents", []),
            "ai_review": state.get("ai_review", {"status": "not_requested"}),
            "pipeline_metrics": read_metrics(workspace),
            "model": state["options"].get("model"),
            "reasoning_effort": state["options"].get("reasoning_effort"),
            "furniture": furniture_report,
            "rebuild_of": state.get("rebuild_of"),
            "edited_of": state.get("edited_of"),
            "refine_of": state.get("refine_of"),
            "restructure_of": state.get("restructure_of"),
            "reidentify_of": state.get("reidentify_of"),
            "design_mode": "manual"
            if state.get("edited_of") or state.get("preserve_design")
            else "automatic",
        }
        (workspace / "consistency-report.json").write_text(
            json.dumps(result["consistency"], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (workspace / "manifest.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        # 成果包保留自定义要求；style 继续存实际建模基调，兼容旧 GLB 构建器。
        layout_path = workspace / "layout.json"
        if layout_path.is_file():
            document = json.loads(layout_path.read_text(encoding="utf-8"))
            document.update(
                style_choice=state["options"]["style"],
                style_description=state["options"].get("style_description", ""),
            )
            layout_path.write_text(
                json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        return {"result": result}

    async def preview(state):
        """独立目录发布真实建筑初稿；不写入人工确认，也不开放正式交付。"""
        job_id = state["job_id"]
        workspace = settings.workspace(job_id)
        layout = Layout.model_validate(state["layout"])
        validate_generated_structure(layout)
        await store.update(job_id, stage="准备三维初稿", progress=47,
                           message="结构已完成几何检查，正在生成真实墙体、门窗和地板")
        from .surface_design import apply_generation_surfaces

        layout = apply_generation_surfaces(layout, state["options"])
        pending = workspace / "initial-pending"
        pending.mkdir(exist_ok=True)
        style = state["options"]["style"]
        report = await model_builder(settings, pending, layout, Furnishing(items=[], notes=[]),
                                     "natural" if style == "custom" else style,
                                     furniture_mode=state["options"].get("furniture_mode", "library"))
        if state.get("source_sha256") != source_hash(workspace / "source.png"):
            raise ValueError("原图在初稿生成期间发生变化，请重新识别")
        initial = workspace / "initial"
        initial.mkdir(exist_ok=True)
        # 构建过程不暴露半写文件；重试时上一份可用初稿仍可查看。
        for filename in ("model.glb", "layout.json"):
            (pending / filename).replace(initial / filename)
        result = {**state["result"], "preview": {
            "model_url": f"/api/jobs/{job_id}/preview/model.glb",
            "layout_url": f"/api/jobs/{job_id}/preview/layout.json",
            "source_reviewed": False,
            "structure_hash": structure_hash(layout),
            "consistency": report.get("consistency", {}),
        }}
        await store.update(job_id, result=result, progress=50,
                           message="三维初稿已可查看，尚未人工核对；正在继续布置家具")
        return {"awaiting_review": False, "result": result}

    graph = StateGraph(State)
    for name, node in [
        ("recognize", recognize),
        ("review", review),
        ("prepare_review", prepare_review),
        ("preview", preview),
        ("furnish", furnish),
        ("build", build),
    ]:
        graph.add_node(name, node)
    graph.add_conditional_edges(
        START,
        lambda state: (
            "prepare_review"
            if state.get("recovered_structure_of")
            and not state.get("confirmed_structure")
            else "furnish"
            if state.get("confirmed_structure")
            else "review"
            if state.get("restructure_of")
            else "furnish"
            if state.get("refine_of")
            else "build"
            if state.get("rebuild_of") or state.get("imported_project")
            else "recognize"
        ),
    )
    graph.add_conditional_edges(
        "recognize",
        lambda state: (
            "prepare_review" if state.get("recognition_review") else
            "review" if state["options"]["collaboration"] else "prepare_review"
        ),
    )
    graph.add_edge("review", "prepare_review")
    graph.add_conditional_edges("prepare_review", lambda state: (
        "preview" if state["options"].get("review_mode") == "preview"
        and not state.get("recovered_structure_of")
        and not state.get("recognition_review")
        and state.get("ai_review", {}).get("status") not in {"timed_out", "incomplete", "needs_review"}
        else END
    ))
    graph.add_edge("preview", "furnish")
    graph.add_edge("furnish", "build")
    graph.add_edge("build", END)
    return graph.compile(checkpointer=checkpointer)


class JobRunner:
    def __init__(self, graph, store, concurrency, settings=None):
        self.graph = graph
        self.store = store
        self.semaphore = asyncio.Semaphore(concurrency)
        self.tasks = {}
        self.settings = settings
        self.closing = False

    def schedule(self, job_id, *, resume=False):
        if job_id in self.tasks and not self.tasks[job_id].done():
            return
        task = asyncio.create_task(self._run(job_id, resume=resume))
        self.tasks[job_id] = task

        def cleanup(completed):
            if self.tasks.get(job_id) is completed:
                self.tasks.pop(job_id, None)

        task.add_done_callback(cleanup)

    async def _run(self, job_id, *, resume=False):
        try:
            async with self.semaphore:
                seed_path = (
                    self.settings.workspace(job_id) / "rebuild-seed.json"
                    if self.settings
                    else None
                )
                seed = (
                    json.loads(seed_path.read_text(encoding="utf-8"))
                    if seed_path and seed_path.exists()
                    else {}
                )
                if not await self.store.update(
                    job_id,
                    status="running",
                    stage="检查已完成步骤，继续生成"
                    if resume
                    else "应用人工设计，准备三维建模"
                    if seed.get("edited_of")
                    else "对照原图复核结构"
                    if seed.get("restructure_of")
                    else "重新读取原图"
                    if seed.get("reidentify_of")
                    else "复用原布局，准备更新家具"
                    if seed
                    else "准备识别",
                    progress=None if resume else 5,
                ):
                    return
                job = await self.store.get(job_id)
                graph_input = {
                    **seed,
                    "job_id": job_id,
                    "options": job["options"],
                    "agents": seed.get("agents", []),
                    "source_sha256": seed.get("source_sha256")
                    or (seed.get("confirmation") or {}).get("source_sha256")
                    or (
                        source_hash(self.settings.workspace(job_id) / "source.png")
                        if self.settings
                        else None
                    ),
                }
                config = {
                    "configurable": {
                        "thread_id": f"{job_id}:confirmed"
                        if seed.get("confirmed_structure")
                        else job_id
                    },
                    "recursion_limit": 12,
                }
                if resume:
                    checkpoint = await self.graph.aget_state(config)
                    if checkpoint.values:
                        saved = checkpoint.values
                        if (
                            saved.get("job_id") != job_id
                            or saved.get("options") != job["options"]
                            or saved.get("source_sha256")
                            != source_hash(
                                self.settings.workspace(job_id) / "source.png"
                            )
                            or saved.get("confirmation") != seed.get("confirmation")
                        ):
                            raise ValueError(
                                "恢复记录与当前原图、结构确认或参数不一致，请重新核对任务"
                            )
                        # 只继续待完成节点。旧任务仍按原选项走人工核对；
                        # preview 模式可以建模，但绝不写入人工确认。
                        graph_input = None
                result = await self.graph.ainvoke(graph_input, config=config)
                if resume and result.get("result", {}).get("model_url"):
                    model = self.settings.workspace(job_id) / "model.glb"
                    if not model.is_file() or model.read_bytes()[:4] != b"glTF":
                        raise ValueError("恢复任务的模型文件缺失或损坏，请重新建模")
                    digest = result["result"].get("consistency", {}).get("model_sha256")
                    if digest and digest != source_hash(model):
                        raise ValueError("恢复任务的模型文件已变化，请重新建模")
                await self.store.update(
                    job_id,
                    status="awaiting_review"
                    if result.get("awaiting_review")
                    else "succeeded",
                    stage="识别结果需要你确认" if result.get("recognition_review") and result.get("awaiting_review") else "等待确认户型结构"
                    if result.get("awaiting_review")
                    else "生成完成",
                    progress=(12 if result.get("recognition_review") else 45) if result.get("awaiting_review") else 100,
                    result=result["result"],
                    message=result["recognition_review"]["message"] if result.get("recognition_review") and result.get("awaiting_review") else "请对照原图确认墙体、门窗与空间，再继续生成三维"
                    if result.get("awaiting_review")
                    else "三维户型已生成，可以在工作台中查看",
                )
        except asyncio.CancelledError:
            await self.store.update(
                job_id,
                status="queued" if self.closing else "cancelled",
                stage="等待服务恢复后继续" if self.closing else "已取消",
                message="已保存已完成的步骤，服务恢复后继续处理"
                if self.closing
                else "任务已停止，原始图片已保留",
            )
            raise
        except SourceImageRejected as exc:
            await self.store.update(
                job_id, status="failed", stage="请更换户型图",
                error=str(exc), message=str(exc),
                result={"input_check": exc.check.model_dump(), "failure": {"code": "input_image_rejected"}},
            )
        except Exception as exc:  # noqa: BLE001 - persist every terminal worker failure
            current = await self.store.get(job_id)
            message = ai_failure_message(exc, current["stage"]) or public_message(
                exc, f"{current['stage']}未完成，请重试；原图和已完成步骤已保留。"
            )
            await self.store.update(
                job_id,
                status="failed",
                stage="生成失败",
                error=message,
                message=message,
                result={**(current.get("result") or {}), "failure": classify_ai_error(exc)},
            )

    async def cancel(self, job_id):
        # 先落库终态，避免生成恰好完成时覆盖用户的取消操作。
        await self.store.update(
            job_id, status="cancelled", stage="已取消", message="任务已取消"
        )
        if task := self.tasks.get(job_id):
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def close(self):
        self.closing = True
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
