"""素材软归档与磁盘统计；归档不删除被方案引用的文件。"""

import asyncio
import json
import re
import time

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .texture_assets import available_textures
from .ai_cache import StageCache


class AssetChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(max_length=100)
    name: str | None = Field(default=None, min_length=1, max_length=60)
    archived: bool | None = None


def install_asset_management_routes(app, library):
    root = library.settings.data_dir.resolve()
    lock = asyncio.Lock()

    def inventory():
        models = [
            entry["item"]
            for entry in library.files().values()
            if entry["item"]["source"] == "imported"
        ]
        textures = [
            item
            for archived in [False, True]
            for item in available_textures(library.settings, archived)["items"]
        ]
        return [
            {
                "id": i["id"],
                "name": i["name"],
                "archived": bool(i.get("archived")),
                "kind": "导入家具",
            }
            for i in models
        ] + [
            {
                "id": i["id"],
                "name": i["name"],
                "archived": bool(i.get("archived")),
                "kind": "墙地面材质",
            }
            for i in textures
        ]

    def usage():
        groups = []
        for folder, name in [
            ("jobs", "户型方案"),
            ("imports", "导入家具"),
            ("materials", "墙地面素材"),
            ("material_sources", "创作底图"),
            ("library", "家具副本"),
            ("ai-cache", "AI 结果缓存"),
        ]:
            size, count, stale = 0, 0, 0
            for path in (root / folder).rglob("*"):
                try:
                    if (
                        path.is_file()
                        and not path.is_symlink()
                        and path.resolve().is_relative_to(root / folder)
                    ):
                        stat = path.stat()
                        size += stat.st_size
                        count += 1
                        if (
                            folder == "ai-cache"
                            and path.suffix == ".json"
                            and stat.st_mtime < time.time() - 30 * 86400
                        ):
                            stale += stat.st_size
                except OSError:
                    continue
            groups.append(
                {"name": name, "bytes": size, "files": count, "cleanable_bytes": stale}
            )
        return groups

    @app.get("/api/library/manage")
    async def listing():
        items, groups = await asyncio.gather(
            asyncio.to_thread(inventory), asyncio.to_thread(usage)
        )
        return {"items": items, "usage": groups}

    @app.post("/api/library/manage")
    async def change(body: AssetChange):
        async with lock:
            if body.id.startswith("texture:") and re.fullmatch(
                r"texture:[a-f0-9]{64}", body.id
            ):
                path = root / "materials" / f"{body.id[8:]}.json"
            elif body.id.startswith("file:"):
                entry = (await asyncio.to_thread(library.files)).get(body.id[5:])
                if not entry or entry["item"]["source"] != "imported":
                    raise HTTPException(404, "可管理的素材不存在")
                path = entry["path"].with_suffix(".json")
            else:
                raise HTTPException(422, "请选择导入家具或墙地面素材")
            if (
                not path.resolve().is_relative_to(root)
                or not path.is_file()
                or path.is_symlink()
            ):
                raise HTTPException(404, "素材记录不存在")
            try:
                data = json.loads(
                    await asyncio.to_thread(path.read_text, encoding="utf-8")
                )
                if body.name is not None:
                    if not body.name.strip():
                        raise HTTPException(422, "素材名称不能为空")
                    data["name"] = body.name.strip()
                if body.archived is not None:
                    data["archived"] = body.archived
                temporary = path.with_suffix(".json.tmp")
                await asyncio.to_thread(
                    temporary.write_text,
                    json.dumps(data, ensure_ascii=False),
                    encoding="utf-8",
                )
                await asyncio.to_thread(temporary.replace, path)
            except (ValueError, OSError, TypeError) as exc:
                raise HTTPException(
                    422, "素材记录无法更新，请先恢复损坏的记录"
                ) from exc
            await asyncio.to_thread(library.files)
        return {"ok": True}

    @app.post("/api/library/cache/clean")
    async def clean():
        # 兼容旧入口，与本机数据管理使用同一清理规则。
        return await asyncio.to_thread(StageCache(root / "ai-cache").prune, 0)
