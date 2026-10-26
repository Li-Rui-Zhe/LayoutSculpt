"""统一索引项目 GLB、DIY 素材与已完成方案，不接受客户端文件路径。"""

import asyncio
import hashlib
import json
import time
import threading
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse

from .config import ROOT
from .library_models import save_snapshot, snapshot_file
from .schemas import Furnishing, Furniture


class LibraryService:
    def __init__(self, settings, store, diy, roots=None):
        self.settings, self.store, self.diy = settings, store, diy
        self.snapshot_cache = {}
        self._files_cache = None
        self._files_until = 0
        self._files_lock = threading.Lock()
        self.roots = roots or [
            (ROOT / "assets", "builtin"),
            (ROOT / "public" / "models", "sample"),
            (settings.data_dir / "imports", "imported"),
        ]
        if not settings.furniture_catalog.resolve().is_relative_to(ROOT / "assets"):
            self.roots = [*self.roots, (settings.furniture_catalog.parent, "builtin")]

    def files(self, refresh=True):
        with self._files_lock:
            if refresh or self._files_cache is None or time.monotonic() >= self._files_until:
                self._files_cache = self._scan_files()
                self._files_until = time.monotonic() + 2
            return self._files_cache

    def _scan_files(self):
        try:
            catalog = json.loads(
                self.settings.furniture_catalog.read_text(encoding="utf-8")
            )
            entries = {item["kind"]: item for item in catalog.get("items", [])}
        except (OSError, ValueError, KeyError):
            entries = {}
        files = {}
        seen = set()
        for root, source in self.roots:
            root = root.resolve()
            if not root.is_dir():
                continue
            for path in sorted(root.rglob("*")):
                if path.suffix.lower() != ".glb":
                    continue
                resolved = path.resolve()
                # 跳过指向项目资源目录之外的链接，路径只在服务端解析。
                if (
                    not resolved.is_relative_to(root)
                    or resolved in seen
                    or not resolved.is_file()
                ):
                    continue
                seen.add(resolved)
                try:
                    stat = resolved.stat()
                except OSError:
                    continue
                identifier = hashlib.sha256(str(resolved).encode()).hexdigest()[:24]
                registered = (
                    entries.get(path.stem)
                    if resolved
                    == (
                        self.settings.furniture_catalog.parent
                        / "glb"
                        / f"{path.stem}.glb"
                    ).resolve()
                    else None
                )
                files[identifier] = {
                    "path": resolved,
                    "item": {
                        "id": f"file:{identifier}",
                        "name": registered["name"]
                        if registered
                        else (
                            {
                                "forest-home-v2": "林间暖居 · 旧版示例",
                                "forest-home-v3": "林间暖居 · 典藏样板间",
                            }.get(path.stem, path.stem)
                        ),
                        "filename": path.name,
                        "source": source,
                        "placeable": source in {"builtin", "imported"},
                        "kind": path.stem if registered else "model",
                        "furniture_kind": registered.get("furniture_kind", path.stem) if registered else "model",
                        "catalog_kind": path.stem if registered else None,
                        **{key: registered.get(key) if registered else None for key in
                           ("family", "variant", "style", "tags", "rooms", "description")},
                        "category": registered.get("category") if registered else None,
                        "revision": registered.get("revision") if registered else None,
                        "default_elevation": registered.get("default_elevation", 0) if registered else 0,
                        "dimensions": registered.get("dimensions")
                        if registered
                        else None,
                        "size_bytes": stat.st_size,
                        "updated_at": datetime.fromtimestamp(
                            stat.st_mtime, timezone.utc
                        ).isoformat(),
                        "model_url": f"/api/library/files/{identifier}/model.glb?v={stat.st_mtime_ns}",
                    },
                }
                if source == "imported":
                    meta_path = path.with_suffix(".json")
                    if meta_path.is_file():
                        try:
                            files[identifier]["item"].update(
                                json.loads(meta_path.read_text(encoding="utf-8"))
                            )
                        except (OSError, ValueError):
                            pass
                    thumb = path.with_suffix(".png")
                    if thumb.is_file():
                        files[identifier]["thumbnail"] = thumb
                        files[identifier]["item"]["thumbnail_url"] = (
                            f"/api/library/files/{identifier}/thumbnail.png"
                        )
                thumbnail_root = (
                    self.settings.furniture_catalog.parent / "thumbnails"
                ).resolve()
                thumbnail = (thumbnail_root / f"{path.stem}.png").resolve()
                if (
                    registered
                    and thumbnail.is_relative_to(thumbnail_root)
                    and thumbnail.is_file()
                ):
                    files[identifier]["thumbnail"] = thumbnail
                    files[identifier]["item"]["thumbnail_url"] = (
                        f"/api/library/files/{identifier}/thumbnail.png?v={thumbnail.stat().st_mtime_ns}"
                    )
        return files

    async def listing(self):
        items = [
            entry["item"] for entry in (await asyncio.to_thread(self.files)).values()
        ]
        for asset in await self.diy.listing():
            if asset["status"] != "ready":
                continue
            items.append(
                {
                    "id": f"diy:{asset['id']}",
                    "asset_id": asset["id"],
                    "name": asset["name"],
                    "source": "diy",
                    "placeable": True,
                    "updated_at": asset["updated_at"],
                    "dimensions": asset["dimensions"],
                    "filename": f"diy-{asset['id']}.glb",
                    "model_url": f"/api/diy/assets/{asset['id']}/model.glb?v={asset['revision']}",
                }
            )
        for job in await self.store.list():
            if job["status"] != "succeeded":
                continue
            path = self.settings.workspace(job["id"]) / "model.glb"
            if not path.is_file() or not path.resolve().is_relative_to(
                self.settings.data_dir.resolve()
            ):
                continue
            items.append(
                {
                    "id": f"job:{job['id']}",
                    "job_id": job["id"],
                    "name": job["name"],
                    "source": "generated",
                    "size_bytes": path.stat().st_size,
                    "updated_at": job["updated_at"],
                    "filename": f"layout-{job['id']}.glb",
                    "model_url": f"/api/jobs/{job['id']}/artifacts/model.glb",
                }
            )
        return {"items": items}

    async def placement(self, identifier):
        """返回独立家具模板；GLB 固定为内容地址副本。"""
        elevation = 0
        if identifier.startswith("diy:"):
            asset = await self.diy.get(identifier[4:])
            if asset["status"] != "ready":
                raise HTTPException(409, "DIY 素材尚未完成")
            from .diy_schema import DiyDesign

            design = DiyDesign.model_validate(asset["design"])
            dimensions = design.dimensions()
            content = {"kind": "custom", "diy": design.model_dump()}
            name = design.name
        elif identifier.startswith("file:"):
            entry = (await asyncio.to_thread(self.files, False)).get(identifier[5:])
            if not entry or not entry["item"]["placeable"]:
                raise HTTPException(404, "该素材不存在或不是可放置家具")
            path = entry["path"]
            try:
                stamp = path.stat()
                if stamp.st_size > 100 * 1024 * 1024:
                    raise ValueError("单个家具模型不能超过 100 MB")
                key = (str(path), stamp.st_mtime_ns, stamp.st_size)
                cached = self.snapshot_cache.get(key)
                if cached is None:
                    data = await asyncio.to_thread(path.read_bytes)
                    cached = await asyncio.to_thread(
                        save_snapshot, self.settings.data_dir / "library", data
                    )
                    if len(self.snapshot_cache) >= 128:
                        self.snapshot_cache.clear()
                    self.snapshot_cache[key] = cached
                asset_id, dimensions = cached
                await asyncio.to_thread(
                    snapshot_file, self.settings.data_dir / "library", asset_id
                )
            except (ValueError, OSError, KeyError, TypeError) as exc:
                raise HTTPException(422, f"无法放置此模型：{exc}") from exc
            content = {"kind": entry["item"]["furniture_kind"], "asset_id": asset_id}
            name = entry["item"]["name"]
            elevation = entry["item"].get("default_elevation", 0)
        else:
            raise HTTPException(
                422, "请从家具或 DIY 素材中选择，整套户型不能作为家具放置"
            )
        factor = min(1, *(limit / n for n, limit in zip(dimensions, [6, 6, 3])))
        width, depth, height = [
            max(minimum, n * factor) for n, minimum in zip(dimensions, [0.1, 0.1, 0.02])
        ]
        return Furniture(
            name=name[:60],
            room_id="unplaced",
            x=0,
            y=0,
            width=width,
            depth=depth,
            height=height,
            rotation=0,
            elevation=1.05 if content["kind"] == "wall_television" else elevation,
            **content,
        ).model_dump()

    async def catalog(self):
        """AI 与人工使用同一索引，目录仅包含有效的可放置素材。"""
        result = []
        for item in (await self.listing())["items"]:
            if not item.get("placeable") or item.get("archived"):
                continue
            try:
                if item.get("dimensions"):
                    dimensions = item["dimensions"]
                    kind = item.get("furniture_kind", item.get("kind", "model"))
                else:
                    template = await self.placement(item["id"])
                    dimensions = [template[k] for k in ["width", "depth", "height"]]
                    kind = template["kind"]
            except HTTPException:
                continue
            result.append(
                {
                    "asset_id": item["id"],
                    "name": item["name"],
                    "version": item["updated_at"],
                    "kind": "model" if kind == "custom" else kind,
                    "dimensions": dimensions,
                    "category": item.get("category"),
                    **{key: item.get(key) for key in ("family", "variant", "style", "tags", "rooms", "description")},
                    "default_elevation": 1.05 if kind == "wall_television" else item.get("default_elevation", 0),
                }
            )
        return result

    async def resolve_furnishing(self, value):
        document = value.model_dump() if isinstance(value, Furnishing) else value
        items = []
        for item in document["items"]:
            item = dict(item)
            asset_id = item.get("asset_id")
            if asset_id:
                if asset_id.startswith("snapshot:"):
                    try:
                        await asyncio.to_thread(
                            snapshot_file, self.settings.data_dir / "library", asset_id
                        )
                    except ValueError as exc:
                        raise HTTPException(422, str(exc)) from exc
                else:
                    template = await self.placement(asset_id)
                    item.update(
                        {key: template[key] for key in ["kind", "diy", "asset_id"]}
                    )
            items.append(item)
        return Furnishing.model_validate({"items": items, "notes": document["notes"]})


def install_library_routes(app, service):
    @app.post("/api/library/import", status_code=201)
    async def import_model(
        file: UploadFile = File(), unit: str = Form("m"), rotation: int = Form(0)
    ):
        if rotation not in {0, 90, 180, 270}:
            raise HTTPException(422, "请选择 0/90/180/270 度朝向")
        if unit not in {"m", "cm", "mm"}:
            raise HTTPException(422, "请选择模型长度单位")
        data = bytearray()
        try:
            while chunk := await file.read(1024 * 1024):
                data.extend(chunk)
                if len(data) > 100 * 1024 * 1024:
                    raise HTTPException(413, "GLB 不能超过 100 MB")
        finally:
            await file.close()
        from .library_models import load_glb, normalize_glb
        from uuid import uuid4
        import re

        def convert():
            scene = load_glb(bytes(data))
            scene.apply_scale({"m": 1, "cm": 0.01, "mm": 0.001}[unit])
            if rotation:
                import trimesh, math

                scene.apply_transform(
                    trimesh.transformations.rotation_matrix(
                        math.radians(rotation), [0, 1, 0]
                    )
                )
            return normalize_glb(scene.export(file_type="glb"))

        try:
            normalized, dimensions = await asyncio.to_thread(convert)
        except (ValueError, OSError, KeyError, IndexError, TypeError) as exc:
            raise HTTPException(422, f"导入失败：{exc}") from exc
        folder = service.settings.data_dir / "imports"
        folder.mkdir(parents=True, exist_ok=True)
        name = (
            re.sub(
                r"[^\w\-\u4e00-\u9fff ]",
                "",
                (file.filename or "导入家具").rsplit(".", 1)[0],
            )[:45]
            or "导入家具"
        )
        path = folder / f"{name}-{uuid4().hex[:8]}.glb"
        from .model_thumbnail import thumbnail

        await asyncio.to_thread(thumbnail, normalized, path.with_suffix(".png"))
        await asyncio.to_thread(
            path.with_suffix(".json").write_text,
            json.dumps({"name": name, "dimensions": dimensions}, ensure_ascii=False),
            encoding="utf-8",
        )
        await asyncio.to_thread(path.write_bytes, normalized)
        await asyncio.to_thread(service.files)
        return {"name": name, "dimensions": dimensions}

    @app.post("/api/library/placement")
    async def placement(body: dict):
        identifier = body.get("id")
        if not isinstance(identifier, str) or len(identifier) > 100:
            raise HTTPException(422, "请选择有效素材")
        return await service.placement(identifier)

    @app.get("/api/library/assets")
    async def listing():
        return await service.listing()

    @app.get("/api/library/files/{identifier}/model.glb")
    async def download(identifier: str):
        entry = (await asyncio.to_thread(service.files, False)).get(identifier)
        if entry is None or not entry["path"].is_file():
            raise HTTPException(404, "素材文件不存在，请刷新素材库")
        return FileResponse(
            entry["path"],
            media_type="model/gltf-binary",
            filename=entry["item"]["filename"],
        )

    @app.get("/api/library/files/{identifier}/thumbnail.png")
    async def thumbnail(identifier: str):
        entry = (await asyncio.to_thread(service.files, False)).get(identifier)
        if not entry or not entry.get("thumbnail") or not entry["thumbnail"].is_file():
            raise HTTPException(404, "素材缩略图不存在")
        return FileResponse(entry["thumbnail"], media_type="image/png")
