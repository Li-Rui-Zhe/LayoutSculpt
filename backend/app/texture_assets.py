"""Immutable local texture assets; only decoded image pixels are retained."""

import asyncio
import hashlib
import io
import json
import re

from fastapi import File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageOps, UnidentifiedImageError

from .surface_design import SurfaceDesign, embedded_design, render_surface


def texture_folder(settings):
    return settings.data_dir / "materials"


def texture_info(path):
    identifier = path.stem
    info = json.loads(path.read_text(encoding="utf-8"))
    result = {
        **info,
        "id": f"texture:{identifier}",
        "surface": f"texture:{identifier}",
        "color": "#ffffff",
        "texture": "custom",
        "family": "自定义贴图",
        "finish": "哑光",
        "sub": "本机导入 · 可重复铺贴",
        "usage": "墙面与地板",
        "roughness": 0.8,
        "type": "walls",
    }
    design = embedded_design(path.with_suffix(".png"))
    if design:
        result.update(
            name=design.name,
            type=design.category,
            categories=[design.category],
            family="DIY 墙面" if design.category == "walls" else "DIY 地板",
            roughness=design.roughness,
            finish="柔光" if design.roughness < 0.5 else "哑光",
            sub=f"{ {'preset':'自主设计','draw':'手绘材质','ai':'AI 材质','upload':'导入创作'}[design.origin]} · {design.repeat} 倍纹理 · {design.rotation}°",
            usage="墙面饰面" if design.category == "walls" else "地板铺装",
            recipe=design.model_dump(exclude_none=True),
            optics=design.optics.model_dump() if design.optics else None,
        )
        if design.optics and design.optics.transmission > 0:
            result["finish"] = "磨砂透光" if design.roughness >= 0.3 else "通透高光"
        elif design.optics and design.optics.metalness > 0.5:
            result["finish"] = "金属反射"
    result["name"] = info.get("name") or result["name"]
    return result


def available_textures(settings, archived=False):
    items, unavailable = [], []
    for path in sorted(texture_folder(settings).glob("*.json")):
        if not re.fullmatch(r"[a-f0-9]{64}", path.stem):
            continue
        try:
            item = texture_info(path)
            if bool(item.get("archived")) == archived:
                items.append(item)
        except (OSError, ValueError, TypeError, KeyError):
            unavailable.append({"id": f"texture:{path.stem}", "message": "材质记录损坏或贴图缺失，其他素材仍可使用"})
    return {"items": items, "unavailable": unavailable}


def install_texture_routes(app, settings):
    root = texture_folder(settings)

    @app.post("/api/materials/preview")
    async def preview(design: SurfaceDesign):
        try:
            data = await asyncio.to_thread(render_surface, design, settings.data_dir)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return Response(data, media_type="image/png")

    @app.post("/api/materials/design", status_code=201)
    async def save_design(design: SurfaceDesign):
        try:
            data = await asyncio.to_thread(render_surface, design, settings.data_dir)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        digest = hashlib.sha256(data).hexdigest()
        root.mkdir(parents=True, exist_ok=True)
        (root / f"{digest}.png").write_bytes(data)
        meta = root / f"{digest}.json"
        meta.write_text(
            json.dumps({"name": design.name}, ensure_ascii=False), encoding="utf-8"
        )
        return texture_info(meta)

    @app.get("/api/materials/custom")
    async def listing(archived: bool = False):
        return await asyncio.to_thread(available_textures, settings, archived)

    @app.get("/api/materials/custom/{digest}.png")
    async def image(digest: str):
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise HTTPException(404, "贴图不存在")
        path = root / f"{digest}.png"
        if not path.is_file():
            raise HTTPException(404, "贴图不存在")
        return FileResponse(path, media_type="image/png")

    @app.post("/api/materials/custom", status_code=201)
    async def upload(
        file: UploadFile = File(), name: str = Form("我的饰面", max_length=60)
    ):
        content = await file.read(10 * 1024 * 1024 + 1)
        await file.close()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(413, "材质图片不能超过 10 MB")

        def prepare():
            try:
                with Image.open(io.BytesIO(content)) as source:
                    if source.width * source.height > 16_000_000:
                        raise ValueError("图片像素过大")
                    if source.format not in {"PNG", "JPEG", "WEBP"}:
                        raise ValueError("仅支持 PNG、JPG、WebP")
                    image = ImageOps.exif_transpose(source).convert("RGB")
                    image.thumbnail((2048, 2048))
                    output = io.BytesIO()
                    image.save(output, format="PNG")
                    return output.getvalue()
            except (UnidentifiedImageError, OSError) as exc:
                raise ValueError("无法读取材质图片") from exc

        try:
            data = await asyncio.to_thread(prepare)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        digest = hashlib.sha256(data).hexdigest()
        root.mkdir(parents=True, exist_ok=True)
        (root / f"{digest}.png").write_bytes(data)
        meta = root / f"{digest}.json"
        if not meta.exists():
            meta.write_text(
                json.dumps({"name": name.strip() or "我的饰面"}, ensure_ascii=False),
                encoding="utf-8",
            )
        return texture_info(meta)
