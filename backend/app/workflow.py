"""LangGraph 管理节点与检查点，LangChain 组合提示词、Codex 模型和结构解析器。"""

import asyncio
import json
import operator
from typing import Annotated, TypedDict

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph

from .codex import CodexChatModel
from .modeling import build_model
from .schemas import Layout, Furnishing, validate_furnishing, signed_area


class State(TypedDict, total=False):
    job_id: str
    options: dict
    layout: dict
    furniture: dict
    agents: Annotated[list[dict], operator.add]
    result: dict
    rebuild_of: str
    edited_of: str


def create_graph(
    settings, store, client, registry, checkpointer, model_builder=build_model
):
    async def run_agent(state, role, skill, output_type, payload, post_validate=None):
        job_id = state["job_id"]
        workspace = settings.workspace(job_id)
        instructions, skills = registry.compose("floorplan-contract", skill)
        (workspace / f"{role}-skills.md").write_text(instructions, encoding="utf-8")
        trace = {
            "role": role,
            "skills": skills,
            "threads": [],
            "model": state["options"].get("model"),
        }

        async def on_event(event):
            if event["type"] == "thread":
                trace["threads"].append(event["thread_id"])
                if event.get("model"):
                    trace["model"] = event["model"]

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
        parser = PydanticOutputParser(pydantic_object=output_type)
        chain = prompt | llm | parser
        repair = ""
        for attempt in range(2):
            try:
                output = await chain.ainvoke(
                    {
                        "task": f"执行项目技能 {skill}，用中文返回符合约定的结构化结果。",
                        "notes": state["options"].get("notes", ""),
                        "payload": json.dumps(payload, ensure_ascii=False),
                        "repair": repair,
                    }
                )
                if post_validate:
                    post_validate(output)
                (workspace / f"{role}.json").write_text(
                    output.model_dump_json(indent=2), encoding="utf-8"
                )
                return output.model_dump(), trace
            except Exception as exc:
                # 只修复结构解析/校验错误，连接、鉴权和进程错误直接交给任务失败流程。
                from langchain_core.exceptions import OutputParserException

                if not isinstance(exc, (ValueError, OutputParserException)) or attempt:
                    raise
                repair = f"上一轮输出未通过结构校验，请根据原图重新输出完整 JSON。错误：{str(exc)[:2400]}"
                await store.update(
                    job_id, message="结构校验发现问题，正在修正一次", agent=role
                )
        raise RuntimeError("结构校验失败")

    async def recognize(state):
        await store.update(
            state["job_id"],
            stage="识别户型结构",
            progress=12,
            agent="户型识别",
            message="正在读取房间、墙体及门窗",
        )
        layout, trace = await run_agent(
            state,
            "recognition",
            "floorplan-recognition",
            Layout,
            {"style": state["options"]["style"]},
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
        layout, trace = await run_agent(
            state, "review", "floorplan-review", Layout, state["layout"]
        )
        return {"layout": layout, "agents": [trace]}

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
        furniture, trace = await run_agent(
            state,
            "furnishing",
            "furniture-planning",
            Furnishing,
            {
                "layout": state["layout"],
                "style": state["options"]["style"],
                "furniture_assets": asset_items,
            },
            lambda plan: validate_furnishing(plan, layout),
        )
        return {"furniture": furniture, "agents": [trace]}

    async def build(state):
        await store.update(
            state["job_id"],
            stage="构建三维模型",
            progress=82,
            agent="Blender 建模",
            message="正在生成真实墙体、门窗及家具模型",
        )
        workspace = settings.workspace(state["job_id"])
        layout = Layout.model_validate(state["layout"])
        furniture_report = await model_builder(
            settings,
            workspace,
            layout,
            Furnishing.model_validate(state["furniture"]),
            state["options"]["style"],
            furniture_mode=state["options"].get("furniture_mode", "library"),
        )
        base = f"/api/jobs/{state['job_id']}/artifacts"
        result = {
            "title": layout.title,
            "area": round(abs(signed_area(layout.outline)), 1),
            "room_count": len(layout.rooms),
            "confidence": layout.confidence,
            "scale_note": layout.scale_note,
            "warnings": layout.warnings + state["furniture"]["notes"],
            "model_url": base + "/model.glb",
            "blend_url": base + "/model.blend",
            "layout_url": base + "/layout.json",
            "source_url": base + "/source.png",
            "agents": state.get("agents", []),
            "model": state["options"].get("model"),
            "reasoning_effort": state["options"].get("reasoning_effort"),
            "furniture": furniture_report,
            "rebuild_of": state.get("rebuild_of"),
            "edited_of": state.get("edited_of"),
        }
        (workspace / "manifest.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return {"result": result}

    graph = StateGraph(State)
    for name, node in [
        ("recognize", recognize),
        ("review", review),
        ("furnish", furnish),
        ("build", build),
    ]:
        graph.add_node(name, node)
    graph.add_conditional_edges(
        START, lambda state: "build" if state.get("rebuild_of") else "recognize"
    )
    graph.add_conditional_edges(
        "recognize",
        lambda state: "review" if state["options"]["collaboration"] else "furnish",
    )
    graph.add_edge("review", "furnish")
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

    def schedule(self, job_id):
        if job_id in self.tasks:
            return
        task = asyncio.create_task(self._run(job_id))
        self.tasks[job_id] = task
        task.add_done_callback(lambda _: self.tasks.pop(job_id, None))

    async def _run(self, job_id):
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
                    stage="应用人工设计，准备三维建模"
                    if seed.get("edited_of")
                    else "复用原布局，准备更新家具"
                    if seed
                    else "准备识别",
                    progress=5,
                ):
                    return
                job = await self.store.get(job_id)
                result = await self.graph.ainvoke(
                    {"job_id": job_id, "options": job["options"], "agents": [], **seed},
                    config={
                        "configurable": {"thread_id": job_id},
                        "recursion_limit": 12,
                    },
                )
                await self.store.update(
                    job_id,
                    status="succeeded",
                    stage="生成完成",
                    progress=100,
                    result=result["result"],
                    message="三维户型已生成，可以在工作台中查看",
                )
        except asyncio.CancelledError:
            await self.store.update(
                job_id,
                status="cancelled",
                stage="已取消",
                message="任务已停止，原始图片已保留",
            )
            raise
        except Exception as exc:
            message = (
                "处理超时，请稍后重试。"
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
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
