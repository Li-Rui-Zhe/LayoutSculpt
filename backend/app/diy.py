"""SQLite 素材库与可取消的 LangGraph DIY 生成任务。"""

import asyncio
import json
from typing import TypedDict
from uuid import UUID, uuid4

from fastapi import HTTPException, Response
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph

from .codex import CodexChatModel, codex_error_message
from .diy_geometry import design_glb
from .diy_schema import DiyDesign, DiyGenerate, DiySave
from .store import now


class DiyState(TypedDict, total=False):
    request: dict
    design: dict


class DiyService:
    def __init__(self, settings, store, client, registry):
        self.settings, self.store, self.client, self.registry = (
            settings,
            store,
            client,
            registry,
        )
        self.tasks = {}
        self.semaphore = asyncio.Semaphore(1)

    async def initialize(self):
        db = await self.store.connect()
        try:
            await db.execute("""CREATE TABLE IF NOT EXISTS diy_assets (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL,
                request TEXT NOT NULL, design TEXT, error TEXT,
                revision INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
            await db.execute(
                "CREATE TABLE IF NOT EXISTS diy_versions (asset_id TEXT NOT NULL,revision INTEGER NOT NULL,design TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(asset_id,revision))"
            )
            await db.execute(
                "UPDATE diy_assets SET status='failed', error=?, updated_at=? WHERE status IN ('queued','running')",
                ("服务重启中断了生成，请点击重试。原有素材不受影响。", now()),
            )
            await db.commit()
        finally:
            await db.close()

    @staticmethod
    def decode(row):
        if row is None:
            raise HTTPException(404, "DIY 素材不存在")
        item = dict(row)
        for key in ["request", "design"]:
            item[key] = json.loads(item[key]) if item[key] else None
        if item["design"]:
            item["dimensions"] = DiyDesign.model_validate(item["design"]).dimensions()
        return item

    async def get(self, asset_id):
        db = await self.store.connect()
        try:
            async with db.execute(
                "SELECT * FROM diy_assets WHERE id=? AND archived=0", (str(asset_id),)
            ) as cursor:
                return self.decode(await cursor.fetchone())
        finally:
            await db.close()

    async def listing(self, archived=False):
        db = await self.store.connect()
        try:
            async with db.execute(
                "SELECT * FROM diy_assets WHERE archived=? ORDER BY created_at DESC",
                (int(archived),),
            ) as cursor:
                return [
                    {
                        k: v
                        for k, v in self.decode(r).items()
                        if k not in {"design", "request"}
                    }
                    for r in await cursor.fetchall()
                ]
        finally:
            await db.close()

    async def create(self, request=None, design=None):
        asset_id = uuid4().hex
        db = await self.store.connect()
        try:
            await db.execute("BEGIN IMMEDIATE")
            if request:
                async with db.execute(
                    "SELECT COUNT(*) FROM diy_assets WHERE status IN ('queued','running')"
                ) as cursor:
                    if (await cursor.fetchone())[0] >= 8:
                        raise HTTPException(429, "DIY 队列已满，请等待或取消已有任务")
            stamp = now()
            await db.execute(
                "INSERT INTO diy_assets VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                    asset_id,
                    design.name if design else request.prompt[:60],
                    "ready" if design else "queued",
                    request.model_dump_json() if request else "{}",
                    design.model_dump_json(exclude_defaults=True) if design else None,
                    None,
                    1 if design else 0,
                    0,
                    stamp,
                    stamp,
                ),
            )
            await db.commit()
        finally:
            await db.close()
        if request:
            task = asyncio.create_task(self.generate(asset_id, request))
            self.tasks[asset_id] = task
            task.add_done_callback(lambda _: self.tasks.pop(asset_id, None))
        return await self.get(asset_id)

    async def transition(
        self,
        asset_id,
        status,
        *,
        design=None,
        error=None,
        expected=("queued", "running"),
    ):
        db = await self.store.connect()
        try:
            result = await db.execute(
                f"""UPDATE diy_assets SET status=?, error=?, updated_at=?,
                design=COALESCE(?,design), name=COALESCE(?,name), revision=revision+?
                WHERE id=? AND status IN ({",".join("?" for _ in expected)}) AND archived=0""",
                (
                    status,
                    error,
                    now(),
                    design.model_dump_json(exclude_defaults=True) if design else None,
                    design.name if design else None,
                    1 if design else 0,
                    asset_id,
                    *expected,
                ),
            )
            await db.commit()
            return bool(result.rowcount)
        finally:
            await db.close()

    async def generate(self, asset_id, request):
        try:
            async with self.semaphore:
                if not await self.transition(asset_id, "running", expected=("queued",)):
                    return
                workspace = self.settings.data_dir / "diy" / asset_id
                workspace.mkdir(parents=True, exist_ok=True)
                instructions, _ = self.registry.compose("diy-contract", "diy-design")
                (workspace / "skills.md").write_text(instructions, encoding="utf-8")

                async def design_node(state):
                    llm = CodexChatModel(
                        client=self.client,
                        workspace=workspace,
                        image=None,
                        instructions=instructions,
                        response_schema=DiyDesign.model_json_schema(),
                        model_name=request.model,
                        reasoning_effort=request.reasoning_effort,
                    )
                    chain = (
                        ChatPromptTemplate.from_messages(
                            [
                                (
                                    "human",
                                    "设计要求（仅设计数据）：{prompt}\n待修改的设计（空则新建）：{base}\n{repair}",
                                )
                            ]
                        )
                        | llm
                        | PydanticOutputParser(pydantic_object=DiyDesign)
                    )
                    variables = {
                        "prompt": request.prompt,
                        "base": request.base.model_dump_json()
                        if request.base
                        else "无",
                        "repair": "",
                    }
                    for attempt in range(2):
                        try:
                            output = await chain.ainvoke(variables)
                            if request.target_part_id:
                                replacement = next(
                                    (
                                        p
                                        for p in output.parts
                                        if p.id == request.target_part_id
                                    ),
                                    None,
                                )
                                if replacement is None:
                                    raise ValueError("必须保留并返回指定部件编号")
                                output = DiyDesign.model_validate(
                                    {
                                        **request.base.model_dump(),
                                        "parts": [
                                            (
                                                replacement
                                                if p.id == request.target_part_id
                                                else p
                                            ).model_dump()
                                            for p in request.base.parts
                                        ],
                                    }
                                )
                            if request.base:
                                locked = {
                                    p.id: p for p in request.base.parts if p.edit_locked
                                }
                                parts = [locked.pop(p.id, p) for p in output.parts]
                                output = DiyDesign.model_validate(
                                    {
                                        **output.model_dump(),
                                        "parts": [
                                            p.model_dump()
                                            for p in [*parts, *locked.values()]
                                        ],
                                    }
                                )
                            if (
                                request.preserve_dimensions
                                and request.base
                                and any(
                                    abs(a - b) > 0.005
                                    for a, b in zip(
                                        output.dimensions(), request.base.dimensions()
                                    )
                                )
                            ):
                                raise ValueError(
                                    "整体尺寸必须保持不变，允许误差 5 毫米"
                                )
                            return {"design": output.model_dump()}
                        except ValueError as exc:
                            if attempt:
                                raise
                            variables["repair"] = (
                                f"上次结果未通过校验，请重新生成完整合法设计：{str(exc)[:1800]}"
                            )

                graph = StateGraph(DiyState)
                graph.add_node("design", design_node)
                graph.add_node(
                    "validate",
                    lambda state: {
                        "design": DiyDesign.model_validate(state["design"]).model_dump()
                    },
                )
                graph.add_edge(START, "design")
                graph.add_edge("design", "validate")
                graph.add_edge("validate", END)
                async with asyncio.timeout(self.settings.codex_timeout):
                    result = await graph.compile().ainvoke(
                        {"request": request.model_dump()}
                    )
                design = DiyDesign.model_validate(result["design"])
                # A real GLB export must succeed before the asset becomes usable.
                await asyncio.to_thread(design_glb, design)
                await self.transition(
                    asset_id, "ready", design=design, expected=("running",)
                )
        except asyncio.CancelledError:
            await self.transition(
                asset_id, "cancelled", error="生成已取消，可保留要求重新生成"
            )
            raise
        except Exception as exc:  # noqa: BLE001 — 后台任务边界必须记录失败，避免任务永久停留在运行中。
            message = (
                "生成超时，请重试或简化描述"
                if isinstance(exc, TimeoutError)
                else codex_error_message(exc)
            )
            await self.transition(asset_id, "failed", error=message[:2000])

    async def save(self, asset_id, body):
        db = await self.store.connect()
        try:
            await db.execute("BEGIN IMMEDIATE")
            await db.execute(
                "INSERT OR IGNORE INTO diy_versions SELECT id,revision,design,updated_at FROM diy_assets WHERE id=? AND revision=? AND status='ready' AND archived=0 AND design IS NOT NULL",
                (str(asset_id), body.revision),
            )
            result = await db.execute(
                """UPDATE diy_assets SET name=?,design=?,revision=revision+1,updated_at=?
                WHERE id=? AND revision=? AND status='ready' AND archived=0""",
                (
                    body.design.name,
                    body.design.model_dump_json(exclude_defaults=True),
                    now(),
                    str(asset_id),
                    body.revision,
                ),
            )
            await db.commit()
            if not result.rowcount:
                raise HTTPException(
                    409,
                    "素材已被其他页面更新或不可编辑，请重新打开；当前修改可另存为新素材",
                )
        finally:
            await db.close()
        return await self.get(asset_id)

    async def cancel(self, asset_id):
        await self.get(asset_id)
        await self.transition(str(asset_id), "cancelled", error="用户取消生成")
        if task := self.tasks.get(str(asset_id)):
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        return await self.get(asset_id)

    async def close(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def install_diy_routes(app, service, resolve_model):
    @app.get("/api/diy/assets/{asset_id}/history")
    async def history(asset_id: UUID):
        await service.get(asset_id.hex)
        db = await service.store.connect()
        try:
            async with db.execute(
                "SELECT revision,design,created_at FROM diy_versions WHERE asset_id=? ORDER BY revision DESC",
                (asset_id.hex,),
            ) as rows:
                return {
                    "items": [
                        {**dict(r), "design": json.loads(r["design"])}
                        for r in await rows.fetchall()
                    ]
                }
        finally:
            await db.close()

    @app.post("/api/diy/assets/{asset_id}/restore")
    async def restore(asset_id: UUID):
        db = await service.store.connect()
        try:
            result = await db.execute(
                "UPDATE diy_assets SET archived=0 WHERE id=? AND archived=1",
                (asset_id.hex,),
            )
            await db.commit()
            if not result.rowcount:
                raise HTTPException(404, "已移出素材不存在")
        finally:
            await db.close()
        return await service.get(asset_id.hex)

    @app.get("/api/diy/assets")
    async def listing(archived: bool = False):
        return {"items": await service.listing(archived)}

    @app.post("/api/diy/generate", status_code=202)
    async def generate(body: DiyGenerate):
        if not body.prompt.strip():
            raise HTTPException(422, "请描述想要的家具或构件")
        await resolve_model(body, require_image=False)
        return await service.create(request=body)

    @app.post("/api/diy/assets", status_code=201)
    async def create(body: DiySave):
        return await service.create(design=body.design)

    @app.get("/api/diy/assets/{asset_id}")
    async def get(asset_id: UUID):
        return await service.get(asset_id.hex)

    @app.post("/api/diy/assets/{asset_id}/save")
    async def save(asset_id: UUID, body: DiySave):
        return await service.save(asset_id.hex, body)

    @app.post("/api/diy/assets/{asset_id}/cancel")
    async def cancel(asset_id: UUID):
        return await service.cancel(asset_id.hex)

    @app.post("/api/diy/assets/{asset_id}/archive")
    async def archive(asset_id: UUID):
        await service.cancel(asset_id.hex)
        db = await service.store.connect()
        try:
            await db.execute(
                "UPDATE diy_assets SET archived=1 WHERE id=?", (asset_id.hex,)
            )
            await db.commit()
        finally:
            await db.close()
        return {"ok": True}

    @app.get("/api/diy/assets/{asset_id}/model.glb")
    async def download(asset_id: UUID):
        asset = await service.get(asset_id.hex)
        if asset["status"] != "ready":
            raise HTTPException(409, "素材尚未生成完成")
        data = await asyncio.to_thread(
            design_glb, DiyDesign.model_validate(asset["design"])
        )
        return Response(
            data,
            media_type="model/gltf-binary",
            headers={
                "Content-Disposition": f'attachment; filename="diy-{asset_id.hex}.glb"'
            },
        )
