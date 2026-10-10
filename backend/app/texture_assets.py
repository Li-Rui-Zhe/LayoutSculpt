"""Immutable local texture assets; only decoded image pixels are retained."""

import asyncio
import hashlib
import io
import json
import re
from fastapi import File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError


def texture_folder(settings):
    return settings.data_dir / "materials"


def texture_info(path):
    identifier = path.stem
    info = json.loads(path.read_text(encoding="utf-8"))
    return {
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


def install_texture_routes(app, settings):
    root = texture_folder(settings)

    @app.get("/api/materials/custom")
    async def listing():
        return {
            "items": [
                texture_info(p)
                for p in sorted(root.glob("*.json"))
                if re.fullmatch(r"[a-f0-9]{64}", p.stem)
            ]
        }

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
