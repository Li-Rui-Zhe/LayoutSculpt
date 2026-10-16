"""Workspace persistence and design inspection shared by all editing pages."""

import json
from typing import Any
from uuid import UUID

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .architecture import structure_issues
from .quality import furnishing_issues
from .schemas import ManualEditRequest
from .store import now


class DraftWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    document: dict[str, Any]


class ProjectMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    archived: bool | None = None
    note: str | None = Field(default=None, max_length=1000)


class ArchiveProject(BaseModel):
    model_config = ConfigDict(extra="forbid")
    archived: bool


async def initialize_workspace(store):
    db = await store.connect()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS workspace_drafts (
                key TEXT PRIMARY KEY, document TEXT NOT NULL,
                revision INTEGER NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS project_metadata (
                job_id TEXT PRIMARY KEY REFERENCES jobs(id),
                archived INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT ''
            );
        """)
        await db.commit()
    finally:
        await db.close()


def install_workspace_routes(app, store, settings=None, library=None):
    import asyncio
    import hashlib
    from time import perf_counter
    from .preview_cache import PreviewCache

    preview_limit = asyncio.Semaphore(1)
    preview_cache = PreviewCache()

    @app.post("/api/jobs/{job_id}/preview")
    async def preview(job_id: UUID, body: ManualEditRequest, request: Request):
        if settings is None:
            raise HTTPException(503, "未配置模型预览")
        job = await store.get(job_id.hex)
        if not job or job["status"] not in {"succeeded", "awaiting_review"}:
            raise HTTPException(409, "请选择已生成或等待核对的户型")
        if library is not None:
            body.furniture = await library.resolve_furnishing(body.furniture)
        from pathlib import Path
        from tempfile import TemporaryDirectory

        from fastapi.responses import Response

        from .modeling import build_model
        from .disconnect import while_connected

        started = perf_counter()
        document = {
            **body.layout.model_dump(),
            "furniture": body.furniture.model_dump()["items"],
            "style": (
                (job.get("result") or {}).get("render_style")
                or job["options"].get("render_style")
                or "natural"
            )
            if job["options"].get("style") == "custom"
            else job["options"].get("style", "natural"),
            "furniture_mode": job["options"].get("furniture_mode", "library"),
        }
        key = hashlib.sha256(json.dumps({
            "job": job_id.hex,
            "document": document,
            "catalog": settings.furniture_catalog.stat().st_mtime_ns,
        }, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

        async def build():
            with TemporaryDirectory(prefix="layout-preview-") as folder:
                await build_model(settings, Path(folder), body.layout, body.furniture, document["style"], document["furniture_mode"])
                return (Path(folder) / "model.glb").read_bytes()

        async def bounded_build():
            async with asyncio.timeout(settings.model_timeout), preview_limit:
                # 等待其他请求时，同一份草稿可能已完成构建。
                cached = preview_cache.get(key)
                if cached is not None:
                    return cached, "hit"
                result = await build()
                preview_cache.put(key, result)
                return result, "miss"
        try:
            result = preview_cache.get(key)
            cache_status = "hit"
            if result is None:
                result, cache_status = await while_connected(request, bounded_build())
        except TimeoutError as exc:
            raise HTTPException(504, "预览等待或生成超时，请稍后重试或减少对象复杂度；当前设计已保留") from exc
        return Response(result, media_type="model/gltf-binary", headers={
            "Cache-Control": "no-store",
            "X-Preview-Cache": cache_status,
            "Server-Timing": f"preview;dur={(perf_counter() - started) * 1000:.1f}",
        })

    def draft_key(key):
        import re

        if not re.fullmatch(
            r"(?:edit|structure|studio|diy|library):(?:[a-f0-9]{32}|new|sample)", key
        ):
            raise HTTPException(422, "草稿标识无效")
        return key

    @app.get("/api/drafts/{key}")
    async def read_draft(key: str):
        key = draft_key(key)
        db = await store.connect()
        try:
            async with db.execute(
                "SELECT * FROM workspace_drafts WHERE key=?", (key,)
            ) as cursor:
                row = await cursor.fetchone()
            return (
                {**dict(row), "document": json.loads(row["document"])}
                if row
                else {"key": key, "document": None, "revision": 0, "updated_at": None}
            )
        finally:
            await db.close()

    @app.post("/api/drafts/{key}")
    async def save_draft(key: str, body: DraftWrite):
        key = draft_key(key)
        try:
            encoded = json.dumps(
                body.document, ensure_ascii=False, allow_nan=False, sort_keys=True
            )
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, "草稿包含无效数值，请检查尺寸、位置等属性") from exc
        if len(encoded.encode("utf-8")) > 2 * 1024 * 1024:
            raise HTTPException(413, "草稿超过 2 MB，请减少对象数量")
        db = await store.connect()
        try:
            await db.execute("BEGIN IMMEDIATE")
            async with db.execute(
                "SELECT revision,document,updated_at FROM workspace_drafts WHERE key=?",
                (key,),
            ) as cursor:
                row = await cursor.fetchone()
            if row and json.loads(row[1]) == body.document:
                return {"revision": row[0], "updated_at": row[2]}
            if (row[0] if row else 0) != body.revision:
                raise HTTPException(
                    409,
                    "其他页面已修改此草稿，请读取最新草稿后继续；当前修改仍保留在浏览器中",
                )
            updated = now()
            await db.execute(
                "INSERT OR REPLACE INTO workspace_drafts VALUES(?,?,?,?)",
                (key, encoded, body.revision + 1, updated),
            )
            await db.commit()
            return {"revision": body.revision + 1, "updated_at": updated}
        finally:
            await db.close()

    @app.post("/api/design/check")
    async def check_design(body: ManualEditRequest):
        # Same checks used by the modeling workflow. Warnings never masquerade
        # as proof that a design is safe or matches the source drawing.
        return {
            "issues": [
                *[
                    {"severity": "warning", "text": text, "category": "furniture"}
                    for text in furnishing_issues(body.furniture, body.layout)
                ],
                *[
                    {"severity": "warning", "text": text, "category": "structure"}
                    for text in structure_issues(body.layout)
                ],
            ],
            "checked_at": now(),
        }

    @app.post("/api/jobs/{job_id}/metadata")
    async def update_metadata(job_id: UUID, body: ProjectMetadata):
        job = await store.get(job_id.hex)
        if not job:
            raise HTTPException(404, "项目不存在")
        if body.archived and job["status"] in {"running", "queued", "awaiting_review"}:
            raise HTTPException(409, "请先完成或取消任务再归档")
        if body.name is not None and not body.name.strip():
            raise HTTPException(422, "名称不能为空")
        db = await store.connect()
        try:
            await db.execute("BEGIN IMMEDIATE")
            await db.execute(
                "INSERT OR IGNORE INTO project_metadata(job_id) VALUES(?)",
                (job_id.hex,),
            )
            if body.name is not None:
                await db.execute(
                    "UPDATE jobs SET name=?,updated_at=? WHERE id=?",
                    (body.name.strip(), now(), job_id.hex),
                )
            if body.archived is not None:
                await db.execute(
                    "UPDATE project_metadata SET archived=? WHERE job_id=?",
                    (int(body.archived), job_id.hex),
                )
            if body.note is not None:
                await db.execute(
                    "UPDATE project_metadata SET note=? WHERE job_id=?",
                    (body.note, job_id.hex),
                )
            await db.commit()
            return {"ok": True}
        finally:
            await db.close()

    @app.get("/api/project-metadata")
    async def metadata():
        db = await store.connect()
        try:
            async with db.execute("SELECT * FROM project_metadata") as cursor:
                return {"items": [dict(row) for row in await cursor.fetchall()]}
        finally:
            await db.close()

    @app.post("/api/projects/{project_id}/archive")
    async def archive_project(project_id: UUID, body: ArchiveProject):
        if settings is None:
            raise HTTPException(503, "未配置项目目录")
        db = await store.connect()
        try:
            await db.execute("BEGIN IMMEDIATE")
            async with db.execute("SELECT id,status FROM jobs") as cursor:
                jobs = {row["id"]: dict(row) for row in await cursor.fetchall()}
            if project_id.hex not in jobs:
                raise HTTPException(404, "项目不存在")
            parents = {}
            for identifier in jobs:
                path = settings.workspace(identifier) / "rebuild-seed.json"
                seed = (
                    json.loads(path.read_text(encoding="utf-8"))
                    if path.is_file()
                    else {}
                )
                parents[identifier] = next(
                    (
                        seed.get(k)
                        for k in (
                            "edited_of",
                            "refine_of",
                            "restructure_of",
                            "rebuild_of",
                        )
                        if seed.get(k)
                    ),
                    None,
                )

            def root(identifier):
                seen = set()
                while parents.get(identifier) in jobs and identifier not in seen:
                    seen.add(identifier)
                    identifier = parents[identifier]
                return identifier

            selected = root(project_id.hex)
            ids = [identifier for identifier in jobs if root(identifier) == selected]
            if body.archived and any(
                jobs[i]["status"] in {"queued", "running", "awaiting_review"}
                for i in ids
            ):
                raise HTTPException(
                    409, "项目含进行中或待核对的版本，请先完成或取消后再归档"
                )
            for identifier in ids:
                await db.execute(
                    "INSERT INTO project_metadata(job_id,archived) VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET archived=excluded.archived",
                    (identifier, int(body.archived)),
                )
            await db.commit()
            return {"ok": True, "count": len(ids)}
        finally:
            await db.close()
