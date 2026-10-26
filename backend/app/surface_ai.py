"""墙地面材质统一由本地 Codex 设计参数，任务存 SQLite。"""

import asyncio
import json
import re
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

from .store import now
from .surface_parametric import MaterialDesignError, generate_material
from .surface_sources import save_source


class SurfaceGenerate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Literal["walls", "floor"]
    prompt: str = Field(min_length=3, max_length=1500)
    method: Literal["parametric"] = "parametric"
    model: str | None = Field(default=None, min_length=1, max_length=160)
    reasoning_effort: str | None = Field(default=None, min_length=1, max_length=40)

    @field_validator("prompt")
    @classmethod
    def nonempty(cls, value):
        if len(value.strip()) < 3:
            raise ValueError("请描述想要的纹理、图案或材质")
        return value.strip()


class SurfaceGenerationService:
    def __init__(self, settings, store, *, client=None, registry=None):
        self.settings, self.store = settings, store
        self.client, self.registry = client, registry
        self.tasks = {}
        self.lock = asyncio.Lock()
        self.gate = asyncio.Semaphore(1)

    async def initialize(self):
        db = await self.store.connect()
        try:
            await db.execute(
                "CREATE TABLE IF NOT EXISTS surface_generations (id TEXT PRIMARY KEY, category TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL, result TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
            )
            cursor = await db.execute("PRAGMA table_info(surface_generations)")
            columns = {row[1] for row in await cursor.fetchall()}
            if "method" not in columns:
                await db.execute(
                    "ALTER TABLE surface_generations ADD COLUMN method TEXT NOT NULL DEFAULT 'image'"
                )
            if "request" not in columns:
                await db.execute("ALTER TABLE surface_generations ADD COLUMN request TEXT")
            await db.execute(
                "UPDATE surface_generations SET status='failed',error='服务重启，生成已中断；可按原参数重新生成' WHERE status IN ('queued','running')"
            )
            await db.commit()
        finally:
            await db.close()

    def schedule(self, identifier, request):
        if identifier in self.tasks:
            return
        task = asyncio.create_task(self.run(identifier, request))
        self.tasks[identifier] = task
        task.add_done_callback(lambda _: self.tasks.pop(identifier, None))

    async def rows(self, category=None, identifier=None, current_only=False):
        db = await self.store.connect()
        try:
            where, values = (
                ("id=?", [identifier])
                if identifier
                else ("category=?", [category])
                if category
                else ("1=1", [])
            )
            if current_only:
                where += " AND method='parametric'"
            cursor = await db.execute(
                f"SELECT * FROM surface_generations WHERE {where} ORDER BY created_at DESC LIMIT 30",
                values,
            )
            items = [dict(row) for row in await cursor.fetchall()]
            for item in items:
                item["result"] = json.loads(item["result"]) if item["result"] else None
                if item["error"] and (
                    item["method"] != "parametric"
                    or "sub2api" in item["error"].lower()
                    or "特殊图案生图" in item["error"]
                ):
                    item["error"] = "材质生成未完成，请调整描述后重试；现有设计已保留。"
            return items
        finally:
            await db.close()

    async def update(self, identifier, status, result=None, error=None):
        db = await self.store.connect()
        try:
            await db.execute(
                "UPDATE surface_generations SET status=?, result=?, error=?, updated_at=? WHERE id=?",
                (
                    status,
                    json.dumps(result, ensure_ascii=False) if result else None,
                    error,
                    now(),
                    identifier,
                ),
            )
            await db.commit()
        finally:
            await db.close()

    async def create(self, request):
        async with self.lock:
            active = [
                row
                for row in await self.rows()
                if row["status"] in {"queued", "running"}
            ]
            if len(active) >= 2 or any(
                row["category"] == request.category for row in active
            ):
                raise HTTPException(409, "当前用途已有生成任务，请等待完成或先取消")
            identifier = uuid4().hex
            db = await self.store.connect()
            try:
                await db.execute(
                    "INSERT INTO surface_generations (id,category,prompt,status,result,error,created_at,updated_at,method,request) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (
                        identifier,
                        request.category,
                        request.prompt,
                        "queued",
                        None,
                        None,
                        now(),
                        now(),
                        request.method,
                        request.model_dump_json(),
                    ),
                )
                await db.commit()
            finally:
                await db.close()
            self.schedule(identifier, request)
            return (await self.rows(identifier=identifier))[0]

    async def run(self, identifier, request):
        try:
            async with self.gate:
                await self.update(identifier, "running")
                content, parameters = await generate_material(self, identifier, request)
                result = await asyncio.to_thread(
                    save_source, self.settings.data_dir, content, request.category, "ai",
                    parameters=parameters,
                )
                if parameters:
                    result.update(
                        parameters=parameters.model_dump(),
                        roughness=parameters.roughness,
                        optics=parameters.optics.model_dump()
                        if parameters.optics
                        else None,
                    )
                await self.update(identifier, "succeeded", result=result)
        except asyncio.CancelledError:
            await self.update(identifier, "cancelled", error="生成已中断，可按原参数重新生成")
            raise
        except Exception as exc:  # noqa: BLE001 - 后台任务必须将非预期失败持久化为可恢复状态。
            # 不向浏览器暴露上游响应、密钥、提示词回显或本机路径。
            message = (
                str(exc)
                if isinstance(exc, MaterialDesignError)
                else "材质生成暂未完成，请稍后重试；现有设计已保留。"
            )
            await self.update(identifier, "failed", error=message)

    async def close(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def install_surface_creation_routes(app, settings, service, resolve_model=None):
    @app.post("/api/materials/source", status_code=201)
    async def source(
        file: Annotated[UploadFile, File()],
        category: Annotated[Literal["walls", "floor"], Form()],
        origin: Annotated[Literal["draw", "upload"], Form()] = "upload",
    ):
        content = await file.read(10 * 1024 * 1024 + 1)
        await file.close()
        try:
            return await asyncio.to_thread(
                save_source, settings.data_dir, content, category, origin
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get("/api/materials/sources/{digest}.png")
    async def source_image(digest: str):
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise HTTPException(404, "底图不存在")
        path = settings.data_dir / "material_sources" / f"{digest}.png"
        if not path.is_file():
            raise HTTPException(404, "底图不存在")
        return FileResponse(path, media_type="image/png")

    @app.get("/api/materials/generations")
    async def generations(category: Literal["walls", "floor"]):
        return {"items": await service.rows(category=category, current_only=True)}

    @app.post("/api/materials/generations", status_code=202)
    async def generate(request: SurfaceGenerate):
        try:
            if resolve_model:
                from .schemas import JobOptions
                options = await resolve_model(JobOptions(model=request.model, reasoning_effort=request.reasoning_effort), require_image=False)
                request = request.model_copy(update={"model": options.model, "reasoning_effort": options.reasoning_effort})
            return await service.create(request)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.post("/api/materials/generations/{identifier}/retry", status_code=202)
    async def retry(identifier: str):
        rows = await service.rows(identifier=identifier)
        if not rows:
            raise HTTPException(404, "生成任务不存在")
        item = rows[0]
        if item["status"] not in {"failed", "cancelled"} or item["method"] != "parametric":
            raise HTTPException(409, "该任务不能继续，请重新填写材质要求")
        try:
            body = SurfaceGenerate.model_validate_json(item["request"]) if item["request"] else SurfaceGenerate(category=item["category"], prompt=item["prompt"])
        except ValueError as exc:
            raise HTTPException(422, "原生成参数无法恢复，请重新填写材质要求") from exc
        return await generate(body)

    @app.post("/api/materials/generations/{identifier}/cancel")
    async def cancel(identifier: str):
        rows = await service.rows(identifier=identifier)
        if not rows:
            raise HTTPException(404, "生成任务不存在")
        task = service.tasks.get(identifier)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            # 尚未运行的 queued task 也需要持久化取消状态。
            current = (await service.rows(identifier=identifier))[0]
            if current["status"] in {"queued", "running"}:
                await service.update(identifier, "cancelled")
        return (await service.rows(identifier=identifier))[0]
