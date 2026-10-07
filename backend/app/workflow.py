"""LangGraph 管理节点与检查点，LangChain 组合提示词、Codex 模型和结构解析器。"""

import asyncio
import json
import operator
import time
from contextlib import nullcontext
from typing import Annotated, TypedDict

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph

from .ai_cache import StageCache, compact_json, read_metrics, record_metric
from .ai_contracts import (
    LayoutExtraction,
    LayoutReviewPatch,
    apply_review_patch,
    pack_layout,
    unpack_layout,
)
from .architecture import structure_issues, validate_generated_structure
from .codex import CodexChatModel, CodexClient, CodexError
from .consistency import source_hash, structure_hash, matches_confirmation
from .modeling import build_model
from .quality import finish_design, prepare_generated_furnishing
from .recovery import REVIEW_TIMEOUT_WARNING
from .resilience import transient_ai_error
from .schemas import Furnishing, Layout, signed_area, validate_furnishing


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
    confirmed_structure: bool
    awaiting_review: bool
    confirmation: dict
    ai_review: dict
    recovered_structure_of: str
    source_sha256: str
    furnishing_status: str


def create_graph(
    settings, store, client, registry, checkpointer, model_builder=build_model
):
    cache = StageCache(settings.data_dir / "ai-cache")

    async def run_agent(
        state, role, skill, output_type, payload, post_validate=None, artifact=None,
        transform=None,
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

        async def on_event(event):
            if event["type"] == "thread":
                trace["threads"].append(event["thread_id"])
                if event.get("model"):
                    trace["model"] = event["model"]
            elif event["type"] == "output_started":
                trace.setdefault(
                    "first_output_seconds", round(time.perf_counter() - started_at, 3)
                )
                await store.update(
                    job_id, agent=role, message="AI 正在返回分析结果，完成后将自动校验"
                )

        llm = CodexChatModel(
            client=client,
            workspace=workspace,
            image=workspace / "source.png",
            instructions=instructions,
            response_schema=output_type.model_json_schema(),
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
            "notes": state["options"].get("notes", ""),
            "payload": compact_json(payload),
            "repair": "",
        }
        trace["input_chars"] = len(instructions) + len(prompt.format(**variables))
        key = cache.key(
            source_sha256=input_digest,
            instructions=instructions,
            prompt=prompt.format(**variables),
            schema=output_type.model_json_schema(),
            model=trace["model"],
            effort=trace["reasoning_effort"],
            role=role,
            runtime=getattr(client, "cache_identity", None),
        )
        enabled = (
            settings.ai_cache_enabled
            and bool(trace["model"])
            and (not isinstance(client, CodexClient) or bool(client.cache_identity))
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
                            agent=role,
                            message="复用相同输入的已校验结果，正在完成本次校验",
                        )
                        return save(output)
                chain = prompt | llm | PydanticOutputParser(pydantic_object=output_type)
                async def invoke_model():
                    while True:
                        try:
                            return await chain.ainvoke(variables)
                        except (CodexError, ConnectionError, TimeoutError) as exc:
                            temporary = transient_ai_error(exc) or (
                                role == "recognition" and isinstance(exc, TimeoutError)
                            )
                            remaining = settings.codex_timeout - (time.perf_counter() - started_at)
                            if not temporary or trace.get("connection_retries", 0) >= 1 or remaining < 15:
                                raise
                            trace["connection_retries"] = 1
                            await store.update(job_id, agent=role,
                                message="AI 连接暂时中断，正在自动重连一次；已完成步骤保留")
                            await asyncio.sleep(0.25)

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

                        if (
                            not isinstance(exc, (ValueError, OutputParserException))
                            or attempt
                        ):
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
                            job_id, message="校验发现问题，正在修正一次", agent=role
                        )
        except asyncio.CancelledError:
            trace["status"] = "cancelled"
            raise
        except Exception as exc:
            trace["status"] = "timed_out" if isinstance(exc, TimeoutError) else "failed"
            raise
        finally:
            trace["elapsed_seconds"] = round(time.perf_counter() - started_at, 3)
            record_metric(workspace, {k: v for k, v in trace.items() if k != "skills"})

    async def recognize(state):
        await store.update(
            state["job_id"],
            stage="识别户型结构",
            progress=12,
            agent="户型识别",
            message="正在读取房间、墙体及门窗",
        )
        extracted, trace = await run_agent(
            state,
            "recognition",
            "floorplan-recognition",
            LayoutExtraction,
            {"task": "依据原图识别实际结构，保持原图朝向、比例和全部可辨认墙体门窗"},
            unpack_layout,
            artifact="recognition-wire",
        )
        workspace = settings.workspace(state["job_id"])
        layout = unpack_layout(extracted).model_dump()
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

    async def review(state):
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
            "layout": pack_layout(candidate),
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
            if isinstance(exc, (CodexError, ConnectionError)) and not transient_ai_error(exc):
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
                {key: item[key] for key in ["kind", "name", "dimensions"]}
                for item in catalog["items"]
            ]
        try:
            furniture, trace = await run_agent(
                state,
                "furnishing",
                "furniture-planning",
                Furnishing,
                {
                    "layout": pack_layout(layout),
                    "style": state["options"]["style"],
                    "furniture_assets": asset_items,
                },
                lambda plan: validate_furnishing(plan, layout),
                transform=lambda plan: prepare_generated_furnishing(plan, layout),
            )
        except (TimeoutError, ValueError, CodexError, ConnectionError) as exc:
            if isinstance(exc, (CodexError, ConnectionError)) and not transient_ai_error(exc):
                raise
            reason = "超时" if isinstance(exc, TimeoutError) else "连接暂时不可用" if transient_ai_error(exc) else "结果无法读取"
            warning = f"家具规划{reason}，已先生成确认的房屋结构；家具尚未完成，可手动布置或重新规划家具。"
            await store.update(state["job_id"], agent="家具规划", message=warning)
            return {"furniture": {"items": [], "notes": [warning]}, "furnishing_status": "incomplete"}
        if not furniture["items"]:
            furniture["notes"] = ["本次方案未包含可放置的家具，已保留完整房屋结构，可手动补充或重新规划家具。", *furniture["notes"]][:20]
        return {"furniture": furniture, "agents": [trace],
                "furnishing_status": "completed" if furniture["items"] else "incomplete"}

    async def prepare_review(state):
        workspace = settings.workspace(state["job_id"])
        if state.get("source_sha256") and state["source_sha256"] != source_hash(
            workspace / "source.png"
        ):
            raise CodexError("原图在处理期间发生变化，请重新识别")
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
        layout = Layout.model_validate(state["layout"])
        layout, furniture, quality = finish_design(
            layout,
            Furnishing.model_validate(state["furniture"]),
            automatic=not bool(state.get("edited_of") or state.get("preserve_design")),
        )
        confirmation = state.get("confirmation")
        if confirmation and (
            not matches_confirmation(layout, confirmation, snapshot=state["layout"])
            or confirmation["source_sha256"] != source_hash(workspace / "source.png")
        ):
            raise ValueError("生成前结构或原图发生变化，请重新确认户型结构")
        if confirmation and confirmation["structure_hash"] != structure_hash(layout):
            confirmation = {**confirmation,
                            "legacy_structure_hash": confirmation["structure_hash"],
                            "structure_hash": structure_hash(layout)}
        quality["furnishing_complete"] = state.get("furnishing_status") != "incomplete"
        (workspace / "quality-report.json").write_text(
            json.dumps(quality, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        furniture_report = await model_builder(
            settings,
            workspace,
            layout,
            furniture,
            state["options"]["style"],
            furniture_mode=state["options"].get("furniture_mode", "library"),
        )
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
            "title": layout.title,
            "area": round(abs(signed_area(layout.outline)), 1),
            "room_count": len(layout.rooms),
            "confidence": layout.confidence,
            "scale_note": layout.scale_note,
            "warnings": layout.warnings + furniture.notes + quality["issues"],
            "quality": quality,
            "delivery_notice": furniture.notes[0] if not quality["furnishing_complete"] else None,
            "delivery_status": "ready" if quality["furnishing_complete"] else "structure_ready",
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
        return {"result": result}

    graph = StateGraph(State)
    for name, node in [
        ("recognize", recognize),
        ("review", review),
        ("prepare_review", prepare_review),
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
            if state.get("rebuild_of")
            else "recognize"
        ),
    )
    graph.add_conditional_edges(
        "recognize",
        lambda state: (
            "review" if state["options"]["collaboration"] else "prepare_review"
        ),
    )
    graph.add_edge("review", "prepare_review")
    graph.add_edge("prepare_review", END)
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
                    stage="服务已恢复，继续未完成的步骤"
                    if resume
                    else "应用人工设计，准备三维建模"
                    if seed.get("edited_of")
                    else "对照原图复核结构"
                    if seed.get("restructure_of")
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
                        if (saved.get("job_id") != job_id
                            or saved.get("options") != job["options"]
                            or saved.get("source_sha256") != source_hash(self.settings.workspace(job_id) / "source.png")
                            or saved.get("confirmation") != seed.get("confirmation")):
                            raise ValueError("恢复记录与当前原图、结构确认或参数不一致，请重新核对任务")
                        # Resume only the pending node. An unconfirmed layout
                        # still ends at prepare_review, never at model building.
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
                    stage="等待确认户型结构"
                    if result.get("awaiting_review")
                    else "生成完成",
                    progress=45 if result.get("awaiting_review") else 100,
                    result=result["result"],
                    message="请对照原图确认墙体、门窗与空间，再继续生成三维"
                    if result.get("awaiting_review")
                    else "三维户型已生成，可以在工作台中查看",
                )
        except asyncio.CancelledError:
            await self.store.update(
                job_id,
                status="queued" if self.closing else "cancelled",
                stage="等待服务恢复后继续" if self.closing else "已取消",
                message="已保存已完成的步骤，服务恢复后继续处理" if self.closing else "任务已停止，原始图片已保留",
            )
            raise
        except Exception as exc:  # noqa: BLE001 - persist every terminal worker failure
            current = await self.store.get(job_id)
            message = (
                f"{current['stage']}超时，未在等待上限内返回结果。已保留原图和已完成的中间结果，可重试。"
                if isinstance(exc, TimeoutError)
                else str(exc)[:1800]
            )
            await self.store.update(
                job_id,
                status="failed",
                stage="生成失败",
                error=message,
                message=message,
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
