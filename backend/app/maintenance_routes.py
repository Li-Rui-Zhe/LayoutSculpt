"""Small local data tools; restoration runs exclusively before server startup."""

import asyncio
import tempfile
import shutil
from pathlib import Path
from typing import Literal

from fastapi import HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from pydantic import BaseModel, ConfigDict, Field

from .data_maintenance import atomic_json, read_json, snapshots, DATA_NAMES, files, export_snapshot
from .ai_cache import StageCache


class MaintenanceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["backup", "restore", "cancel"]
    id: str | None = Field(default=None, pattern=r"^[0-9Ta-f-]{1,40}$")


def install_maintenance_routes(app, settings):
    lock = asyncio.Lock()
    root = settings.data_dir

    @app.get("/api/maintenance/backups/{identifier}/download")
    async def download_backup(identifier: str):
        async with lock:
            selected = next((v for v in snapshots(root) if v["id"] == identifier), None)
            if not selected:
                raise HTTPException(404, "备份不存在，请刷新列表")
            if shutil.disk_usage(tempfile.gettempdir()).free < selected["bytes"] + 128 * 1024 * 1024:
                raise HTTPException(409, "临时空间不足，请释放磁盘空间后重试")
            with tempfile.NamedTemporaryFile(prefix="layoutsculpt-backup-", suffix=".zip", delete=False) as temporary:
                path = Path(temporary.name)
            try:
                # 取消请求时也等打包线程退出，避免 Windows 文件句柄未关闭就清理。
                task = asyncio.create_task(asyncio.to_thread(export_snapshot, root, identifier, path))
                try:
                    await asyncio.shield(task)
                except asyncio.CancelledError:
                    await task
                    raise
            except BaseException as exc:
                path.unlink(missing_ok=True)
                if isinstance(exc, (ValueError, OSError)):
                    raise HTTPException(409, "备份校验或打包失败，原数据未改动，请检查备份和磁盘空间") from exc
                raise
            return FileResponse(path, media_type="application/zip", filename=f"LayoutSculpt-backup-{identifier}.zip",
                                background=BackgroundTask(path.unlink, missing_ok=True))

    @app.post("/api/maintenance/cache")
    async def clean_cache():
        async with lock:
            result = await asyncio.to_thread(StageCache(root / "ai-cache").prune, 0)
            return {**result, "message": "已清理可重建的 AI 缓存，项目和素材均保留。下次生成可能需要重新分析。"}

    @app.get("/api/maintenance")
    async def status():
        def read():
            return {"backups": snapshots(root),
                    "pending": read_json(root / "maintenance-request.json", {}),
                    "project_bytes": sum(p.stat().st_size for n in DATA_NAMES for p in files(root / n)),
                    "cache_bytes": sum(p.stat().st_size for p in files(root / "ai-cache"))}
        return await asyncio.to_thread(read)

    @app.post("/api/maintenance")
    async def schedule(body: MaintenanceRequest):
        async with lock:
            path = root / "maintenance-request.json"
            if body.action == "cancel":
                path.unlink(missing_ok=True)
                return {"message": "已取消下次启动的数据操作。"}
            if body.action == "restore" and body.id not in {v["id"] for v in snapshots(root)}:
                raise HTTPException(404, "备份不存在，请刷新列表。")
            await asyncio.to_thread(atomic_json, path, body.model_dump())
            return {"message": "已安排，下次启动项目时执行。恢复前会额外备份当前数据。" if body.action == "restore" else "已安排，下次启动项目时备份。"}
