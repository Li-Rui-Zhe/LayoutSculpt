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
from shapely.geometry import LineString, box

from .ai_cache import StageCache, compact_json, read_metrics, record_metric
from .ai_contracts import (
    LayoutReviewPatch,
    apply_review_patch,
)
from .ai_failures import ai_failure_message, classify_ai_error
from .ai_requests import asset_input, furnishing_schema, layout_input, review_schema
from .architecture import structure_issues, validate_generated_structure
from .asset_selection import select_candidates
from .automatic_review import apply_evidence_patch, merged_findings
from .codex import CodexChatModel, CodexClient, CodexError
from .consistency import matches_confirmation, source_hash, structure_hash
from .floorplan_evidence import (
    compare_floorplan_mask,
    run_floorplan_evidence,
    select_wall_repair_targets,
)
from .furnishing_quality import functional_gaps
from .input_quality import SourceImageRejected
from .local_structure_repair import (
    apply_local_structure,
    choose_repair_regions,
    needs_fresh_read,
    outline_regions,
    same_place,
)
from .modeling import build_model
from .opening_review import (
    cloud_opening_context,
    mask_aperture_context,
    needs_manual_structure_review,
    outline_pixel_context,
    plan_opening_review,
)
from .outline_recesses import (
    detect_outline_recesses,
    layout_recess_findings,
    prioritize_recess_crops,
    recess_findings,
    trim_room_edge_spills,
)
from .parallel_read import independent_reads
from .public_errors import public_message
from .quality import finish_design, prepare_generated_furnishing
from .recognition_checkpoint import (
    RecognitionCheckpoint,
    checkpoint_candidate,
    validation_summary,
)
from .recognition_contract import RecognitionExtraction, validate_recognition
from .resilience import transient_ai_error
from .schemas import (
    CustomStyleFurnishing,
    Furnishing,
    Layout,
    signed_area,
    validate_furnishing,
)
from .source_evidence import (
    DetailRegion,
    PixelLayoutExtraction,
    SourceEvidence,
    alignment_from_evidence,
    compare_source,
    detail_views,
    image_wall_findings,
    opening_findings,
    pixel_wire,
    update_comparison,
    validate_evidence,
)
from .wall_evidence import apply_wall_detail, combine_wall_observations


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
    source_kind: str
    furnishing_status: str
    furnishing_resume: bool
    furnishing_targets: list
    style_scheme: dict
    render_style: str
    recognition_review: dict
    source_alignment: dict
    source_evidence: dict
    prepared_audit: dict
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
        local_review = role in {"wall_detail", "structure_detail", "automatic_review"}
        agent_name = {"source_evidence": "原图定位", "recognition_pixels": "户型识别", "source_audit": "独立复核", "wall_detail": "墙段复核", "structure_detail": "局部结构修正", "automatic_review": "AI 结构定稿", "geometry_recovery": "AI 几何修复"}.get(role, role)
        if role == "recognition" or (role == "geometry_recovery" and output_type is RecognitionExtraction):
            from .recognition_contract import RecognitionContract

            response_schema = RecognitionContract.model_json_schema()
        elif role in {"furnishing", "furnishing_completion"}:
            response_schema = furnishing_schema(
                output_type,
                library=state["options"].get("furniture_mode", "library") == "library",
                surface_catalog=payload.get("surface_catalog"),
            )
        elif role == "review" or local_review:
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
            "notes": "" if local_review or role in {"source_evidence", "source_audit", "geometry_recovery"} else state["options"].get("notes", ""),
            "payload": compact_json(payload),
            "repair": "",
        }
        trace["input_chars"] = len(instructions) + len(prompt.format(**variables))
        cache_runtime = getattr(client, "cache_identity", None)
        if state.get("reidentify_of") and (local_review or role in {"geometry_recovery", "recognition", "recognition_pixels", "source_evidence", "source_audit", "review"}):
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
                        output = await asyncio.to_thread(validate, output_type.model_validate(cached))
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
                                local_review or not temporary
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
                        output = await asyncio.to_thread(validate, output)
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
                            or attempt or local_review
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

    async def recover_geometry(state, checkpoint, skill, output_type, validate, context, images=None):
        await store.update(state["job_id"], stage="自动修复户型几何", agent="AI 几何修复",
                           message="AI 正对照原图修复无法建模的位置，然后重新校验")
        return await run_agent(
            state, "geometry_recovery", skill, output_type,
            {**context, "candidate": checkpoint.candidate, "issues": checkpoint.attempts,
             "task": "对照原图修正候选结构中的几何错误，保留图上可辨的房间、墙和开口，返回可建模的完整结构。"},
            validate, reference_images=images,
        )

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
        agents = []
        try:
            extracted, trace = await run_agent(
                state, "recognition", "floorplan-recognition", RecognitionExtraction,
                {"task": "依据原图识别实际结构，保持原图朝向、比例和全部可辨认墙体门窗"},
                validate_recognition, artifact="recognition-wire",
            )
        except RecognitionCheckpoint as checkpoint:
            if len(checkpoint.candidate["outline"]) >= 3:
                layout, review = checkpoint_candidate(checkpoint.candidate, checkpoint.attempts)
                if review["can_continue"]:
                    return {"layout": layout, "recognition_review": review, "agents": [checkpoint.trace]}
            agents.append(checkpoint.trace)
            extracted, trace = await recover_geometry(
                state, checkpoint, "floorplan-recognition", RecognitionExtraction, validate_recognition, {},
            )
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
        return {"layout": layout, "agents": [*agents, trace]}

    async def recognize_precise(state):
        workspace = settings.workspace(state["job_id"])
        source = workspace / "source.png"
        with Image.open(source) as image:
            size = image.size
        await store.update(state["job_id"], stage="定位原图轮廓与墙线", progress=8,
                           message="先沿真实墙线读取外轮廓、凹口与尺寸，不根据房间名称补墙", agent="原图定位")
        evidence_result, local = await independent_reads(
            run_agent(
                state, "source_evidence", "floorplan-source-evidence", SourceEvidence,
                {"image_size": list(size), "task": "独立读取原图像素证据；当前没有任何候选结构"},
                lambda output: validate_evidence(output, size),
            ),
            asyncio.to_thread(run_floorplan_evidence, settings.data_dir, source),
        )
        if isinstance(evidence_result, BaseException):
            raise evidence_result
        evidence_data, evidence_trace = evidence_result
        evidence = SourceEvidence.model_validate(evidence_data)
        alignment = alignment_from_evidence(evidence, size)
        alignment["source_sha256"] = source_hash(source)
        primary_evidence = evidence
        structural_prior = evidence_data
        retry_evidence = evidence
        local_context = {}
        recesses = []
        contrast_regions = []
        if isinstance(local, BaseException):
            local = None
        mask = None
        if local is not None:
            mask, local_metadata = local
            (regions, decision, disputed_types), recesses = await asyncio.gather(
                asyncio.to_thread(plan_opening_review, evidence, mask, size),
                asyncio.to_thread(detect_outline_recesses, source, mask),
            )
            alignment["local_segmentation"] = {
                **local_metadata, "opening_review": decision, "outline_recesses": recesses,
            }
            if recesses:
                outline_conflicts = recess_findings(evidence.outline_px, recesses)
                regions = prioritize_recess_crops(regions, outline_conflicts)
                local_context["local_exterior_recesses"] = {
                    "confirmed_wall_paths": recesses,
                    "instruction": "分割与原图墙线共同定位到三面凹口。path_px 是整图像素中的有序外墙路径 A→B→C→D，A、D 向两侧外墙连接，B、C 是凹口内端。A、D 之间朝图外的空隙是室外，保留两侧高低差，不能画连接 A、D 的直墙。把三个墙段同时落实到外轮廓、外墙和相邻房间边界；核对裁图后微调墙中心。",
                }
                contrast_regions = [
                    finding["box"] for finding in outline_conflicts
                    if any(r.get("low_contrast") and r["box"] == finding["box"] for r in recesses)
                ]
                if contrast_regions:
                    disputed_areas = [box(*region) for region in contrast_regions]
                    structural_prior = {
                        **evidence_data,
                        "outline_px": [],
                        "walls_px": [
                            wall.model_dump() for wall in evidence.walls_px
                            if not any(area.covers(LineString([wall.a, wall.b]))
                                       for area in disputed_areas)
                        ],
                    }
                    local_context["local_exterior_recesses"]["faint_plan_rule"] = (
                        "初读的外轮廓在淡色凹口处偏移，已移除该轮廓。以同坐标灰阶增强裁图"
                        "和 path_px 给出的墙中心点为准，沿原图接回外轮廓。四点横纵坐标不可"
                        "被相邻家具、窗台或外轮廓延长线替代。"
                    )
            primary_evidence = evidence.model_copy(update={"regions": regions})
            retry_evidence = evidence.model_copy(update={
                "openings_px": [opening for index, opening in enumerate(evidence.openings_px)
                                if index not in disputed_types],
            })
            outline_context = outline_pixel_context(evidence, mask, size)
            if len(outline_context) == 2:
                local_report = alignment["local_segmentation"]
                local_report["outline_checks"] = outline_context
                local_report["aperture_candidates"] = mask_aperture_context(mask, size)
                # Both axes have independent pixel disagreement. A weak first
                # geometry read is retained for audit, but is no longer the
                # geometry prior used by the detailed reader and its retries.
                structural_prior = {
                    **evidence_data, "outline_px": [], "walls_px": [], "openings_px": [],
                }
                retry_evidence = evidence.model_copy(update={"openings_px": []})
                local_context["local_outline_checks"] = {
                    "scans": outline_context,
                    "instruction": "第一次读到的外轮廓和洞口坐标与原图像素不一致，已经从本轮输入撤下。请用给定的整图像素位置、原图及裁图重画实际外边界。水平扫描的范围是 x，竖直扫描的范围是 y。扫描和分割框都是定位线索，不能当作最终外轮廓或直接当作墙中心线。",
                }
                local_context["local_aperture_candidates"] = local_report["aperture_candidates"]
                local_context["local_opening_rule"] = "门窗框是原图整图像素 [left,top,right,bottom]。优先复看每个门候选的门垛或墙端，门扇弧线仅用来判断开向。确认后才在所属墙段添加洞口；对未出现框但原图可见的洞口照常补充。保留开放通路和阳台凹凸边界。"
            elif decision["selected_count"]:
                local_context.update({
                    "local_opening_hints": cloud_opening_context(decision),
                    "local_opening_rule": "局部候选只用于定位复核。分割可能混淆墙、窗和门。以局部原图中的洞口端点、双线、门扇和墙端为准；外轮廓和其他房间照常读取。",
                })
        images, views = await asyncio.to_thread(
            detail_views, source, workspace, primary_evidence, contrast_regions=contrast_regions
        )
        audit_images, audit_views = images, views
        if local_context and state["options"].get("collaboration"):
            audit_images, audit_views = await asyncio.to_thread(
                detail_views, source, workspace, evidence, prefix="independent-audit"
            )
            alignment["audit_views"] = audit_views
        alignment["views"] = views
        await store.update(state["job_id"], stage="细读房间与门窗", progress=12,
            message=f"已定位建筑轮廓，结合整图{'和 ' + str(len(images)) + ' 张局部图' if images else ''}读取房间与门窗，再由程序统一换算尺寸", agent="户型识别")

        def meters(output):
            return validate_recognition(RecognitionExtraction.model_validate(pixel_wire(output, alignment)))

        def verify_pixel_layout(output):
            layout = meters(output)
            differences = opening_findings(layout.model_dump(), retry_evidence, alignment)
            if differences:
                regions = "；".join(
                    f"{f['message']} 整图像素范围 {[round(v) for v in f['box']]}"
                    for f in differences
                )
                raise ValueError(f"请重新对照原图检查洞口，仅修改图上有依据的部分。{regions}")

        recognition_agents = []
        checkpoint = None
        prepared_audit = None
        try:
            pixel_read = run_agent(
                state, "recognition_pixels", "floorplan-pixel-recognition", PixelLayoutExtraction,
                {"image_size": list(size), "source_evidence": structural_prior, "image_views": views,
                 "meters_per_pixel": alignment["meters_per_pixel"], "task": "固定建筑骨架，再划分净空房间和安装门窗；所有二维点使用整图像素坐标", **local_context},
                verify_pixel_layout, artifact="recognition-pixels", reference_images=images,
                transform=lambda output: trim_room_edge_spills(output, recesses, alignment["meters_per_pixel"]),
            )
            if state["options"].get("collaboration"):
                await store.update(state["job_id"], message="正在细读房间，同时独立核对原图；两次读取互不参考结果")
                pixel_result, audit_result = await independent_reads(pixel_read, read_source_audit(state, size, audit_views, audit_images))
                if isinstance(audit_result, SourceImageRejected):
                    raise audit_result
                prepared_audit = ({"status": "incomplete"} if isinstance(audit_result, BaseException)
                                  else {"status": "completed", "data": audit_result[0], "trace": audit_result[1]})
                if isinstance(pixel_result, BaseException):
                    raise pixel_result
                pixels, trace = pixel_result
            else:
                pixels, trace = await pixel_read
            layout = meters(PixelLayoutExtraction.model_validate(pixels)).model_dump()
        except RecognitionCheckpoint as failure:
            try:
                wire = pixel_wire(PixelLayoutExtraction.model_validate(failure.candidate), alignment)
                layout, checkpoint = checkpoint_candidate(wire, failure.attempts)
            except ValueError:
                # Coordinates outside the source image cannot be snapped in model space.
                checkpoint = None
            trace = failure.trace
            if not checkpoint or not checkpoint["can_continue"]:
                recognition_agents.append(trace)
                pixels, trace = await recover_geometry(
                    state, failure, "floorplan-pixel-recognition", PixelLayoutExtraction, meters,
                    {"image_size": list(size), "image_views": views, "source_evidence": structural_prior,
                     "meters_per_pixel": alignment["meters_per_pixel"], **local_context}, images,
                )
                layout = meters(PixelLayoutExtraction.model_validate(pixels)).model_dump()
                checkpoint = None
        layout["dimension_basis"] = {
            "source": "image_dimensions" if alignment["scale_basis"]["anchor_count"] else "estimated",
            "anchors": [], "inconsistent": alignment["scale_uncertain"],
        }
        detail_agents = []
        comparison = await asyncio.to_thread(compare_source, layout, evidence, alignment, source=source)
        if not checkpoint:
            audit = None
            audit_walls = []
            targeted = []
            before_checks = []
            broad_disagreement = False
            mixed_disagreement = False
            local_findings = compare_floorplan_mask(mask, layout, alignment) if local is not None else None
            if prepared_audit and prepared_audit["status"] == "completed":
                audit = SourceEvidence.model_validate(prepared_audit["data"])
                audit_result = await asyncio.to_thread(compare_source, layout, audit, alignment, source=source)
                audit_walls = audit_result["findings"]
                broad_disagreement = needs_fresh_read(audit_result)
                mixed_disagreement = local_findings is not None and needs_manual_structure_review(
                    audit_result, local_findings
                )
                if not broad_disagreement and not mixed_disagreement:
                    pixel_checks = await asyncio.to_thread(image_wall_findings, source, layout, alignment, mask=mask)
                    outlines = outline_regions(layout, audit, alignment) if audit_result["outline_overlap"] < .9 else []
                    recess_checks = layout_recess_findings(layout, alignment)
                    before_checks = [comparison["findings"], audit_walls, pixel_checks, recess_checks]
                    targeted = choose_repair_regions(
                        comparison["findings"], audit_walls, pixel_checks, recess_checks + outlines
                    )
            disputed = [f for f in combine_wall_observations(comparison["findings"], audit_walls) if f["blocking"]]
            repaired = None
            if broad_disagreement:
                alignment["local_repair"] = {"status": "recognize_again"}
            elif mixed_disagreement:
                alignment["local_repair"] = {"status": "needs_review"}
            elif targeted:
                if local_findings:
                    targeted = [
                        dict(target, local_segmentation=[
                            finding for finding in local_findings
                            if box(*target["box"]).intersects(box(*finding["box"]))
                        ])
                        for target in targeted
                    ]
                repaired = await repair_structure_regions(state, Layout.model_validate(layout), targeted, before_checks, evidence, audit, alignment, source, mask)
                alignment["local_repair"] = {"status": "applied" if repaired else "needs_review", "targets": targeted}
            elif disputed:
                if local is not None:
                    disputed, manual = await asyncio.to_thread(
                        select_wall_repair_targets, mask, layout, alignment, disputed
                    )
                    if manual:
                        alignment["wall_repair_review"] = {
                            "deferred": manual,
                            "selected_count": min(3, len(disputed)),
                        }
                if disputed:
                    candidate = Layout.model_validate(layout)
                    repaired = await repair_wall_spans(state, candidate, disputed[:3], evidence, audit, alignment, source)
            if repaired:
                layout, detail_trace = repaired
                detail_agents.append(detail_trace)
                comparison = await asyncio.to_thread(compare_source, layout, evidence, alignment, source=source)
        alignment = update_comparison(alignment, comparison)
        alignment["image_findings"] = await asyncio.to_thread(image_wall_findings, source, layout, alignment, mask=mask)
        alignment["image_findings"].extend(layout_recess_findings(layout, alignment))
        alignment["findings"].extend(alignment["image_findings"])
        (workspace / "recognition.json").write_text(json.dumps(layout, ensure_ascii=False), encoding="utf-8")
        (workspace / "recognition-meta.json").write_text(json.dumps({"source_sha256": source_hash(source), "structure_hash": structure_hash(layout)}), encoding="utf-8")
        if local is not None:
            alignment["local_segmentation"]["findings"] = compare_floorplan_mask(mask, layout, alignment)
        layout["warnings"] = list(dict.fromkeys(layout["warnings"] + alignment["warnings"]))[:30]
        (workspace / "source-alignment.json").write_text(json.dumps(alignment, ensure_ascii=False), encoding="utf-8")
        result = {"layout": layout, "source_alignment": alignment, "source_evidence": evidence_data,
                  "agents": [evidence_trace, *recognition_agents, trace, *detail_agents]}
        if prepared_audit:
            result["prepared_audit"] = prepared_audit
        if checkpoint:
            result["recognition_review"] = checkpoint
        elif any(f["blocking"] for f in alignment["findings"]):
            result["ai_review"] = {"status": "needs_review", "message": "原图证据与当前识别存在差异。"}
        return result

    async def repair_structure_regions(
        state, candidate, targets, before_checks, evidence, audit, alignment, source, mask
    ):
        pad = max(18, 0.6 / alignment["meters_per_pixel"])
        regions = [
            DetailRegion(
                box=[
                    max(0, x0 - pad),
                    max(0, y0 - pad),
                    min(alignment["image_width"], x1 + pad),
                    min(alignment["image_height"], y1 + pad),
                ],
                reason=finding["message"],
            )
            for finding in targets
            for x0, y0, x1, y1 in [finding["box"]]
        ]
        workspace = settings.workspace(state["job_id"])
        images, views = await asyncio.to_thread(
            detail_views,
            source,
            workspace,
            evidence.model_copy(update={"regions": regions}),
            prefix="structure-detail",
        )
        if not images:
            return None
        await store.update(
            state["job_id"],
            stage="核对并修正局部结构",
            progress=32,
            agent="局部结构修正",
            message="对照门窗、墙线和外轮廓的局部原图；其余结构保留",
        )

        def validate_detail(patch):
            layout = apply_local_structure(
                candidate, patch, views, alignment
            ).model_dump()
            after_checks = [
                compare_source(layout, evidence, alignment, source=source)["findings"],
                compare_source(layout, audit, alignment, source=source)["findings"],
                image_wall_findings(source, layout, alignment, mask=mask),
                layout_recess_findings(layout, alignment),
            ]
            improved = False
            for before, after in zip(before_checks, after_checks, strict=True):
                old = [f for f in before if f["blocking"]]
                new = [f for f in after if f["blocking"]]
                if any(
                    not any(same_place(f, previous) for previous in old) for f in new
                ):
                    raise ValueError("局部修正引入了新的原图分歧")
                improved |= any(
                    any(same_place(f, target) for target in targets)
                    and not any(same_place(f, current) for current in new)
                    for f in old
                )
            if not improved:
                raise ValueError("局部修正后没有证据表明疑点减少")

        try:
            async with asyncio.timeout(
                min(settings.review_timeout, settings.codex_timeout)
            ):
                patch, trace = await run_agent(
                    state,
                    "structure_detail",
                    "floorplan-review",
                    LayoutReviewPatch,
                    {
                        "task": "复核所列的局部结构疑点。以原图和对应裁图为证据。先核对是否真有墙或门窗，再作最小补丁；开放通道可以缩短误画的延长墙；对照粗外墙线保留真实实墙，门窗须有可辨认的洞口；凸出空间须同时核对外轮廓、墙、房间和出入口。允许只修正有把握的部分，含糊的结构保留待核对。补丁使用布局原有米制坐标。",
                        **({"recess_rule": "path_px 是凹口的三段连续外墙。同步修正外轮廓、墙段和贴邻房间。凹口中部通向室外。用 origin_px 和 meters_per_pixel 换算补丁坐标。"}
                           if any(f["code"] == "outline_recess_mismatch" for f in targets) else {}),
                        "layout": layout_input(candidate),
                        "base_revision": structure_hash(candidate),
                        "local_findings": targets,
                        "image_views": views,
                        "origin_px": alignment["origin_px"],
                        "meters_per_pixel": alignment["meters_per_pixel"],
                    },
                    validate_detail,
                    artifact="structure-detail-patch",
                    reference_images=images,
                )
            return apply_local_structure(
                candidate, LayoutReviewPatch.model_validate(patch), views, alignment
            ).model_dump(), trace
        except (ValueError, TimeoutError, CodexError, ConnectionError):
            return None

    async def repair_wall_spans(state, candidate, findings, evidence, audit, alignment, source):
        # Include both junctions and the adjacent space so a cabinet or doorway can be distinguished.
        pad = max(18, .6 / alignment["meters_per_pixel"])
        regions = []
        for f in findings:
            x0, y0, x1, y1 = f["box"]
            regions.append(DetailRegion(box=[max(0, x0-pad), max(0, y0-pad),
                min(alignment["image_width"], x1+pad), min(alignment["image_height"], y1+pad)], reason=f["message"]))
        workspace = settings.workspace(state["job_id"])
        images, views = await asyncio.to_thread(detail_views, source, workspace,
            evidence.model_copy(update={"regions": regions}), prefix="wall-detail")
        if not images:
            return None
        await store.update(state["job_id"], stage="核对疑似漏墙", progress=18, agent="墙段复核",
                           message="正在对照疑似缺墙的位置及两端交点，检查墙段、门洞和家具边线")

        observations = [evidence, audit] if audit else [evidence]

        def compare(layout):
            return [
                *(compare_source(layout, observed, alignment, source=source)["findings"]
                  for observed in observations),
                layout_recess_findings(layout, alignment),
            ]

        baseline = await asyncio.to_thread(compare, candidate.model_dump())

        def validate_detail(patch):
            data = apply_wall_detail(candidate, patch, findings, views, alignment).model_dump()
            checks = compare(data)
            remaining = combine_wall_observations(checks[0], checks[1] if audit else [])
            for target in findings:
                span = LineString(target["span_px"]).buffer(4)
                if any(span.intersection(LineString(f["span_px"])).length >= 8 for f in remaining):
                    raise ValueError("修正后疑点位置仍有墙线缺失")
            for old, new in zip(baseline, checks):
                if any(f["blocking"] and f["code"] != "missing_wall" and f not in old for f in new):
                    raise ValueError("修正引入了新的原图分歧，请核对候选结构")

        try:
            async with asyncio.timeout(min(settings.review_timeout, settings.codex_timeout)):
                patch, trace = await run_agent(state, "wall_detail", "floorplan-review", LayoutReviewPatch,
                    {"task": "仅复核所列墙段。第一张是整图，其后局部图按 image_views 对应。只提交有图像依据的局部增量补丁；保留洞口、开放空间和无关结构，拿不准时在 warnings 说明。",
                     "layout": layout_input(candidate), "base_revision": structure_hash(candidate),
                     "local_findings": findings, "image_views": views, "origin_px": alignment["origin_px"],
                     "meters_per_pixel": alignment["meters_per_pixel"]},
                    validate_detail, artifact="wall-detail-patch", reference_images=images)
            return apply_review_patch(candidate, patch).model_dump(), trace
        except (ValueError, TimeoutError, CodexError, ConnectionError):
            return None

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
            validate_generated_structure(candidate)
            status = "timed_out" if isinstance(exc, TimeoutError) else "incomplete"
            reason = "AI 结构复核超时" if status == "timed_out" else "AI 结构复核未完成"
            warning = f"{reason}，已保留通过几何校验的识别结构。"
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

    async def read_source_audit(state, size, views, images):
        async with asyncio.timeout(min(settings.review_timeout, settings.codex_timeout)):
            return await run_agent(
                state, "source_audit", "floorplan-source-evidence", SourceEvidence,
                {"image_size": list(size), "image_views": views, "task": "独立读取原图像素证据；不参考之前的识别结果或结论。第一张是整图，局部图按 image_views 对应裁切矩形，局部点需加左上角回到整图。所有输出仍用整图像素坐标。"},
                lambda output: validate_evidence(output, size), reference_images=images,
            )

    async def independent_review(state):
        workspace = settings.workspace(state["job_id"])
        size = (state["source_alignment"]["image_width"], state["source_alignment"]["image_height"])
        await store.update(state["job_id"], stage="独立对照原图", progress=40,
            message="正在对照独立读图结果，核对外轮廓、房间与门窗洞口", agent="原图复核")
        prepared = state.get("prepared_audit")
        try:
            saved_alignment = state["source_alignment"]
            views = saved_alignment.get("audit_views", saved_alignment.get("views", []))
            prefix = "independent-audit" if "audit_views" in saved_alignment else "recognition-detail"
            images = [workspace / f"{prefix}-{i + 1}.png" for i in range(len(views))]
            if not all(path.is_file() for path in images):
                views, images = [], []
            if saved_alignment.get("source_sha256") != source_hash(workspace / "source.png"):
                raise CodexError("原图已变化，不能复用独立复核")
            if prepared and prepared["status"] == "completed":
                audit_data, trace = prepared["data"], prepared["trace"]
                validate_evidence(SourceEvidence.model_validate(audit_data), size)
            else:
                if prepared:
                    await store.update(state["job_id"], message="已保留户型结构，正在单独补跑原图复核")
                audit_data, trace = await read_source_audit(state, size, views, images)
                prepared = {"status": "completed", "data": audit_data, "trace": trace}
            audit = SourceEvidence.model_validate(audit_data)
            previous = state["source_alignment"]
            comparison = await asyncio.to_thread(compare_source, state["layout"], audit, previous, source=workspace / "source.png")
            comparison["findings"] = merged_findings(previous["findings"], comparison["findings"])
            alignment = update_comparison(previous, comparison, independent=True)
            audit_scale = alignment_from_evidence(audit, size)
            if audit.dimensions and abs(audit_scale["meters_per_pixel"] / alignment["meters_per_pixel"] - 1) > 0.12:
                alignment["findings"].append({"code": "dimension_disagreement", "message": "两次独立读图得到的尺寸比例不一致，请先核对尺寸。", "blocking": True})
            alignment["audit_outline"] = audit.outline_px
            issues = [f["message"] for f in alignment["findings"]]
            needs_resolution = any(f["blocking"] for f in alignment["findings"])
            report = {"status": "needs_review" if needs_resolution else "completed", "method": "independent_source_comparison",
                      "summary": "；".join(issues) if issues else "已完成独立读图对照，未发现达到提示阈值的结构差异；仍建议查看原图叠加结果。"}
            agents = [trace]
        except (TimeoutError, ValueError, CodexError, ConnectionError):
            alignment = state["source_alignment"]
            report = {"status": "incomplete", "method": "independent_source_comparison", "message": "独立读图复核未完成，已保留通过几何校验的识别结构。"}
            agents = []
        (workspace / "source-alignment.json").write_text(json.dumps(alignment, ensure_ascii=False), encoding="utf-8")
        return {"source_alignment": alignment, "ai_review": report, "agents": agents,
                **({"prepared_audit": prepared} if prepared else {})}

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

        def validate_asset_references(plan):
            for item in plan.items:
                if item.asset_id and (
                    item.asset_id not in allowed_assets
                    or item.kind != allowed_assets[item.asset_id]["kind"]
                ):
                    raise ValueError("家具素材 ID 或类型不在本次目录中，请使用目录提供的 asset_id 和 kind")

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
            validate_asset_references(plan)

        planned_rooms = set()
        planned_names = set()

        def prepare_plan(plan):
            # 先核对来源，再做几何修正，避免错误素材被删除后绕过检查。
            validate_asset_references(plan)
            planned_rooms.clear()
            planned_rooms.update((item.room_id, item.kind) for item in plan.items)
            planned_names.clear()
            planned_names.update((item.room_id, item.kind, item.name or item.kind) for item in plan.items)
            return prepare_generated_furnishing(plan, layout, assets=allowed_assets)

        continuing = bool(state.get("furnishing_resume") and state.get("furniture", {}).get("items"))
        if continuing:
            furniture = state["furniture"]
            style_scheme = state.get("style_scheme", {})
            traces = []
        else:
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
                    transform=prepare_plan,
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
                warning = f"家具规划{reason}，已保留通过几何校验的房屋结构，家具尚未完成，可手动布置或重新规划家具。"
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
            traces = [trace]
        retained = Furnishing.model_validate(furniture)
        gaps = functional_gaps(layout, retained, state["options"].get("notes", ""))
        # 仅补明确用途的必需项；用户明确不要的项目已由检查器排除。
        recover = [gap for gap in gaps if (
            gap["room_id"] in state.get("furnishing_targets", []) if continuing else (
                any(room == gap["room_id"] and kind in gap["kinds"] for room, kind in planned_rooms)
                or any(asset.get("kind") in gap["kinds"] for asset in allowed_assets.values())
            )
        )]
        if recover:
            await store.update(state["job_id"], stage="完善家具方案", progress=72,
                               message="正在为放不下的主要家具寻找合适尺寸，已完成布置保持不动")
            def prepare_additions(plan):
                # 补充请求不能改变饰面、结构或已完成的家具。
                for item in plan.items:
                    if item.asset_id and (item.asset_id not in allowed_assets or item.kind != allowed_assets[item.asset_id]["kind"]):
                        raise ValueError("补充家具必须来自本次目录")
                    if not any(item.room_id == gap["room_id"] and item.kind in gap["kinds"] for gap in recover):
                        raise ValueError("只补充指定房间缺少的核心家具，不重复添加其他物件")
                if len(plan.items) > 10:
                    raise ValueError("局部补充最多 10 件家具")
                return prepare_generated_furnishing(plan, layout, assets=allowed_assets, fixed_items=retained.items)
            try:
                additions, completion_trace = await run_agent(
                    state, "furnishing_completion", "furniture-planning", Furnishing,
                    {"layout": layout_input(layout), "furniture_assets": asset_input(asset_items),
                     "completion_only": True, "missing_functions": recover,
                     "fixed_furniture": [item.model_dump() for item in retained.items],
                     "previous_issues": retained.notes, "style": state["options"]["style"]},
                    transform=prepare_additions,
                )
                extra = Furnishing.model_validate(additions)
                if len(retained.items) + len(extra.items) <= 90:
                    retained.items.extend(extra.items)
                    retained.notes = list(dict.fromkeys([*extra.notes, *retained.notes]))[:20]
                    remaining = {gap["room_id"] for gap in functional_gaps(layout, retained, state["options"].get("notes", ""))}
                    resolved = [gap for gap in recover if gap["room_id"] not in remaining]
                    labels = {name for gap in resolved for room, kind, name in planned_names
                              if room == gap["room_id"] and kind in gap["kinds"]}
                    retained.notes = [note for note in retained.notes if not any(
                        note.startswith(f"暂未放置{label}：") for label in labels)]
                    if resolved:
                        if not remaining:
                            retained.notes = [note for note in retained.notes if not (
                                note.endswith("尚未完成，已保留现有布置；可继续补齐，无需重新生成整屋。")
                                or note.startswith("局部补充未完成，")
                            )]
                        retained.notes = ["已完成主要家具的局部补充，其他有效布置保持不动。", *retained.notes][:20]
                traces.append(completion_trace)
            except (TimeoutError, ValueError, CodexError, ConnectionError):
                retained.notes = ["局部补充未完成，已保留可用家具布置，可继续人工设计。", *retained.notes][:20]
        furniture = retained.model_dump()
        (settings.workspace(state["job_id"]) / "furnishing-quality.json").write_text(
            json.dumps({"completion_requested": recover, "remaining": functional_gaps(layout, retained, state["options"].get("notes", "")),
                        "notes": retained.notes, "furniture_count": len(retained.items)}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        if library:
            furniture = (await library.resolve_furnishing(furniture)).model_dump()
            validate_furnishing(Furnishing.model_validate(furniture), layout)
        unresolved = functional_gaps(layout, retained, state["options"].get("notes", ""))
        if unresolved and furniture["items"]:
            room_names = {room.id: room.name for room in layout.rooms}
            missing = "、".join(f"{room_names[gap['room_id']]}的{gap['need']}" for gap in unresolved)
            furniture["notes"] = [f"{missing}尚未完成，已保留现有布置；可继续补齐，无需重新生成整屋。", *furniture["notes"]][:20]
        if not furniture["items"]:
            furniture["notes"] = [
                "本次方案未包含可放置的家具，已保留完整房屋结构，可手动补充或重新规划家具。",
                *furniture["notes"],
            ][:20]
        return {
            "furniture": furniture,
            "agents": traces,
            "style_scheme": style_scheme,
            "furnishing_status": "completed" if furniture["items"] and not unresolved else "incomplete",
            "furnishing_targets": [gap["room_id"] for gap in unresolved],
        }

    async def automatic_review(state):
        workspace = settings.workspace(state["job_id"])
        candidate = Layout.model_validate(state["layout"])
        if not candidate.rooms or not candidate.walls:
            raise ValueError("AI 修复后仍缺少可建模的房间或墙体")
        checkpoint = state.get("recognition_review") or {}
        previous = state.get("ai_review") or {}
        await store.update(state["job_id"], stage="AI 自动定稿", progress=42, agent="AI 结构定稿",
                           message="正在综合原图和已完成的校验，确定本次建模结构")
        alignment = state.get("source_alignment")
        findings = (alignment or {}).get("findings", [])
        agents = []
        status = previous.get("status")
        selected, selected_alignment = candidate, alignment

        def validate_decision(patch):
            nonlocal selected, selected_alignment
            selected, selected_alignment = apply_evidence_patch(state, workspace, candidate, patch)

        try:
            async with asyncio.timeout(min(settings.review_timeout, settings.codex_timeout)):
                patch, trace = await run_agent(
                    state, "automatic_review", "floorplan-review", LayoutReviewPatch,
                    {"task": "根据原图裁定剩余疑点。有明确依据时作最小修正；证据不足时保留可建模结构，将估算写入 warnings。",
                     "layout": layout_input(candidate), "base_revision": structure_hash(candidate),
                     "local_findings": findings, "geometry_checks": structure_issues(candidate),
                     "prior_attempts": checkpoint.get("attempts", []), "adjustments": checkpoint.get("adjustments", []),
                     "origin_px": (alignment or {}).get("origin_px"), "meters_per_pixel": (alignment or {}).get("meters_per_pixel")},
                    validate_decision,
                )
            candidate, alignment = selected, selected_alignment
            agents.append(trace)
            unresolved = [f for f in (alignment or {}).get("findings", []) if f["blocking"]]
            if previous.get("status") in {"incomplete", "timed_out"}:
                summary = "独立复核未完成，已结合现有原图证据定稿。"
            elif unresolved or patch["warnings"]:
                status = "estimated"
                summary = "平面图已定稿，部分结构按现有原图证据估算。"
            else:
                status = "completed"
                summary = patch["summary"]
        except (TimeoutError, ValueError, CodexError, ConnectionError):
            status = "incomplete"
            summary = "AI 未得到通过校验的进一步修正，已保留当前可建模结构。"
        notes = list(checkpoint.get("adjustments", []))
        notes.extend(f["message"] for f in (alignment or {}).get("findings", []) if f["blocking"])
        if status != "completed":
            notes.insert(0, summary)
        report = {"status": status, "method": "automatic_resolution", "summary": summary,
                  "notes": list(dict.fromkeys(notes))}
        layout = candidate.model_dump()
        (workspace / "recognition.json").write_text(json.dumps(layout, ensure_ascii=False), encoding="utf-8")
        (workspace / "recognition-meta.json").write_text(json.dumps({
            "source_sha256": source_hash(workspace / "source.png"), "structure_hash": structure_hash(candidate),
        }), encoding="utf-8")
        if alignment:
            (workspace / "source-alignment.json").write_text(json.dumps(alignment, ensure_ascii=False), encoding="utf-8")
        return {"layout": layout, "ai_review": report, "recognition_review": {}, "agents": agents,
                **({"source_alignment": alignment} if alignment else {})}

    async def prepare_review(state):
        workspace = settings.workspace(state["job_id"])
        if state.get("source_sha256") and state["source_sha256"] != source_hash(
            workspace / "source.png"
        ):
            raise CodexError("原图在处理期间发生变化，请重新识别")
        layout = Layout.model_validate(state["layout"])
        if not layout.rooms or not layout.walls:
            raise ValueError("无法建模，户型缺少房间或墙体")
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
            "awaiting_review": state["options"].get("review_mode", "manual") == "manual",
            "result": {
                "title": layout.title,
                "area": round(abs(signed_area(layout.outline)), 1),
                "room_count": len(layout.rooms),
                "scale_note": layout.scale_note,
                "warnings": list(
                    dict.fromkeys(
                        layout.warnings
                        + structure_issues(layout)
                        + (state.get("ai_review") or {}).get("notes", [])
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
            automatic=not bool(state.get("edited_of") or state.get("preserve_design") or state.get("furnishing_resume")),
            requirements=state["options"].get("notes", ""),
        )
        if not (state.get("edited_of") or state.get("preserve_design") or state.get("furnishing_resume")):
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
        quality["pending_furniture"] = state.get("furnishing_targets", [])
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
        quality.update(furniture_report.get("lighting", {}))
        (workspace / "quality-report.json").write_text(
            json.dumps(quality, ensure_ascii=False, indent=2), encoding="utf-8"
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
        review_report = state.get("ai_review") or {}
        review_notes = review_report.get("notes", [])
        if review_report.get("message") and review_report.get("status") in {"incomplete", "timed_out"}:
            review_notes = [review_report["message"], *review_notes]
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
            "warnings": list(dict.fromkeys(layout.warnings + furniture.notes + quality["issues"]
                + review_notes)),
            "quality": quality,
            "delivery_notice": (furniture.notes[0] if furniture.notes else "家具布置尚未完成，已保留当前空间，可继续补齐。")
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
                "source_kind": state.get("source_kind", "uploaded_plan"),
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
        ("automatic_review", automatic_review),
        ("prepare_review", prepare_review),
        ("preview", preview),
        ("furnish", furnish),
        ("build", build),
    ]:
        graph.add_node(name, node)

    def after_review(state):
        findings = (state.get("source_alignment") or {}).get("findings", [])
        if state.get("recognition_review") or any(f["blocking"] for f in findings):
            return "automatic_review"
        return "prepare_review"

    def after_recognition(state):
        if state.get("recognition_review") and not state.get("source_alignment"):
            return "automatic_review"
        return "review" if state["options"]["collaboration"] else after_review(state)

    graph.add_conditional_edges(
        START,
        lambda state: (
            after_review(state)
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
    graph.add_conditional_edges("recognize", after_recognition)
    graph.add_conditional_edges("review", after_review)
    graph.add_edge("automatic_review", "prepare_review")
    graph.add_conditional_edges("prepare_review", lambda state: (
        END if state["awaiting_review"] else "preview"
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
                        # 只继续待完成节点，保留任务已保存的审核选择。
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
                    stage="等待确认户型结构" if result.get("awaiting_review") else "生成完成",
                    progress=45 if result.get("awaiting_review") else 100,
                    result=result["result"],
                    message="请对照原图确认平面结构，确认后将自动完成三维生成"
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
