"""Portable, validated project archives. Import always creates a new project."""

import asyncio
import hashlib
import io
import json
import re
import zipfile
from uuid import uuid4

from fastapi import File, HTTPException, Request, UploadFile
from pydantic import ValidationError

from .config import ROOT
from .archive_limits import MAX_ENTRIES, MAX_COMPRESSED, MAX_UNCOMPRESSED
from .library_models import load_glb
from .schemas import Furnishing, JobOptions, Layout, ManualEditRequest, signed_area


def read_project_archive(content):
    if len(content) > MAX_COMPRESSED:
        raise ValueError("项目包不能超过 200 MB")
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_ENTRIES or sum(i.file_size for i in infos) > MAX_UNCOMPRESSED:
                raise ValueError("项目包解压后过大")
            if len({i.filename for i in infos}) != len(infos):
                raise ValueError("项目包含重复文件")
            for item in infos:
                if item.filename.startswith(
                    ("/", "\\")
                ) or ".." in item.filename.replace("\\", "/").split("/"):
                    raise ValueError("项目包文件名无效")
            for name, limit in [
                ("layout.json", 2 * 1024 * 1024),
                ("source.png", 20 * 1024 * 1024),
            ]:
                if archive.getinfo(name).file_size > limit:
                    raise ValueError("户型数据或原图过大")
            data = json.loads(archive.read("layout.json"))
            layout = Layout.model_validate(
                {k: v for k, v in data.items() if k in Layout.model_fields}
            )
            furniture = Furnishing.model_validate(
                {
                    "items": data.get("furniture", []),
                    "notes": data.get("furniture_notes", []),
                }
            )
            # Validate references and dimensions before writing any project data.
            ManualEditRequest(name="导入项目", layout=layout, furniture=furniture)
            snapshots = {}
            for f in furniture.items:
                if not f.asset_id:
                    continue
                if not re.fullmatch(r"snapshot:[a-f0-9]{64}", f.asset_id):
                    raise ValueError("家具引用必须为随包保存的模型副本")
                digest = f.asset_id.split(":")[1]
                path = f"furniture/{digest}.glb"
                if archive.getinfo(path).file_size > 100 * 1024 * 1024:
                    raise ValueError("家具模型过大")
                raw = archive.read(path)
                if hashlib.sha256(raw).hexdigest() != digest:
                    raise ValueError("家具文件校验失败")
                load_glb(raw)
                snapshots[digest] = raw
            textures = {}
            references = [r.floor_material for r in layout.rooms]
            for w in layout.walls:
                references.extend(
                    [
                        w.wall_material,
                        w.material_left,
                        w.material_right,
                        *[r.material for r in w.finish_regions],
                    ]
                )
            for ref in set(references):
                if not ref or not ref.startswith("texture:"):
                    continue
                digest = ref.split(":")[1]
                name = f"textures/{digest}.png"
                if archive.getinfo(name).file_size > 10 * 1024 * 1024:
                    raise ValueError("材质图片过大")
                raw = archive.read(name)
                if hashlib.sha256(raw).hexdigest() != digest:
                    raise ValueError("材质图片校验失败")
                from PIL import Image

                with Image.open(io.BytesIO(raw)) as image:
                    if image.format != "PNG" or image.width * image.height > 16_000_000:
                        raise ValueError("材质图片格式无效")
                    image.verify()
                textures[digest] = raw
            options = JobOptions(
                style=data.get("style_choice", data.get("style", "natural")),
                style_description=data.get("style_description", ""),
                render_style=data.get("style", "natural"),
                furniture_mode=data.get("furniture_mode", "library"),
            )
            return (
                layout,
                furniture,
                options,
                archive.read("source.png"),
                snapshots,
                textures,
            )
    except (ValueError, KeyError, OSError, zipfile.BadZipFile, ValidationError) as exc:
        raise ValueError(f"无法恢复项目：{exc}") from exc


def install_transfer_routes(app, store, settings, public, normalize_image):
    @app.post("/api/projects/sample", status_code=201)
    async def copy_sample():
        import shutil

        from PIL import Image, ImageDraw

        from scripts.build_showcase import document

        data = document()
        layout = Layout.model_validate(
            {k: v for k, v in data.items() if k in Layout.model_fields}
        )
        furniture = Furnishing.model_validate(
            {"items": data.get("furniture", []), "notes": []}
        )
        identifier = uuid4().hex
        workspace = settings.workspace(identifier)
        workspace.mkdir(parents=True)
        await asyncio.to_thread(
            shutil.copyfile,
            ROOT / "public/models/forest-home-v3.glb",
            workspace / "model.glb",
        )
        data = {
            **layout.model_dump(),
            "furniture": furniture.model_dump()["items"],
            "style": "natural",
            "furniture_mode": "library",
        }
        (workspace / "layout.json").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8"
        )
        (workspace / "manifest.json").write_text(
            json.dumps(
                {
                    "source": "authored_sample",
                    "note": "示例副本的原图是示意平面图，保存人工设计版本会按可编辑对象重新建模。",
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        points = data["outline"]
        low = [min(p[k] for p in points) for k in ["x", "y"]]
        high = [max(p[k] for p in points) for k in ["x", "y"]]
        scale = 940 / max(b - a for a, b in zip(low, high))
        image = Image.new("RGB", (1000, 1000), "white")
        draw = ImageDraw.Draw(image)
        transform = lambda p: (
            (p["x"] - low[0]) * scale + 30,
            (p["y"] - low[1]) * scale + 30,
        )
        for room in data["rooms"]:
            draw.polygon(
                [transform(p) for p in room["polygon"]],
                fill="#e9e4d4",
                outline="#b3bdad",
            )
        for w in data["walls"]:
            draw.line(
                [transform(w["start"]), transform(w["end"])],
                fill="#354f40",
                width=max(2, round(w["thickness"] * scale)),
            )
        image.save(workspace / "source.png")
        await store.create(
            identifier,
            "林间暖居 · 我的设计副本",
            JobOptions(style="natural").model_dump(),
        )
        await store.update(
            identifier,
            status="succeeded",
            progress=100,
            stage="示例副本已准备",
            result={
                "title": layout.title,
                "area": round(abs(signed_area(layout.outline)), 1),
                "room_count": len(layout.rooms),
                "model_url": f"/api/jobs/{identifier}/artifacts/model.glb",
                "layout_url": f"/api/jobs/{identifier}/artifacts/layout.json",
            },
            message="已创建独立可编辑示例副本",
        )
        return public(await store.get(identifier))

    @app.post("/api/projects/import", status_code=201)
    async def import_project(request: Request, file: UploadFile = File()):
        content = bytearray()
        try:
            while chunk := await file.read(1024 * 1024):
                content.extend(chunk)
                if len(content) > MAX_COMPRESSED:
                    raise HTTPException(413, "项目包不能超过 200 MB")
        finally:
            await file.close()
        try:
            (
                layout,
                furniture,
                options,
                source,
                snapshots,
                textures,
            ) = await asyncio.to_thread(read_project_archive, bytes(content))
            source = await asyncio.to_thread(normalize_image, source)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        identifier = uuid4().hex
        workspace = settings.workspace(identifier)
        workspace.mkdir(parents=True)
        (workspace / "source.png").write_bytes(source)
        library = settings.data_dir / "library"
        library.mkdir(parents=True, exist_ok=True)
        texture_root = settings.data_dir / "materials"
        texture_root.mkdir(parents=True, exist_ok=True)
        for digest, data in textures.items():
            (texture_root / f"{digest}.png").write_bytes(data)
            if not (texture_root / f"{digest}.json").exists():
                (texture_root / f"{digest}.json").write_text(
                    json.dumps({"name": "恢复的自定义饰面"}, ensure_ascii=False),
                    encoding="utf-8",
                )
        for digest, data in snapshots.items():
            temporary = library / f"{uuid4().hex}.tmp"
            temporary.write_bytes(data)
            temporary.replace(library / f"{digest}.glb")
        (workspace / "rebuild-seed.json").write_text(
            json.dumps(
                {
                    "layout": layout.model_dump(),
                    "furniture": furniture.model_dump(),
                    "imported_project": True,
                    "preserve_design": True,
                    "render_style": options.render_style,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        await store.create(
            identifier,
            f"{layout.title} · 恢复副本"[:120],
            options.model_dump(),
            message="项目包已恢复为独立副本，正在重建三维",
        )
        request.app.state.runner.schedule(identifier)
        return public(await store.get(identifier))
