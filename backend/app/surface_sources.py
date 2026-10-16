"""手绘、导入与 AI 底图只接收解码后的像素，独立于已发布材质库。"""

import hashlib
import io
import json
import warnings
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageOps, PngImagePlugin, UnidentifiedImageError


def save_source(root: Path, content: bytes, category: str, origin: str, *, parameters=None):
    if len(content) > 10 * 1024 * 1024:
        raise ValueError("底图不能超过 10 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as source:
                if (
                    source.format not in {"PNG", "JPEG", "WEBP"}
                    or source.width * source.height > 16_000_000
                ):
                    raise ValueError("请选择不超过 1600 万像素的 PNG、JPG 或 WebP 图片")
                source = ImageOps.exif_transpose(source).convert("RGBA")
                # 透明笔画统一合成到白底，避免模型中出现透明洞。
                image = Image.new("RGBA", source.size, "white")
                image.alpha_composite(source)
                image = image.convert("RGB")
                image = ImageOps.fit(
                    image, (1024, 1024), method=Image.Resampling.LANCZOS
                )
    except (
        OSError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise ValueError("无法读取这张材质底图") from exc
    meta = PngImagePlugin.PngInfo()
    meta.add_text(
        "surface_source", json.dumps({"category": category, "origin": origin})
    )
    if parameters is not None:
        # 只接受服务端验证后的配方；上传图片里的任意元数据仍会被剥离。
        meta.add_text("surface_parameters", parameters.model_dump_json())
    output = io.BytesIO()
    image.save(output, "PNG", pnginfo=meta)
    data = output.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    folder = root / "material_sources"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{digest}.png"
    if not target.exists():
        temporary = folder / f"{uuid4().hex}.tmp"
        temporary.write_bytes(data)
        temporary.replace(target)
    return {
        "id": f"source:{digest}",
        "url": f"/api/materials/sources/{digest}.png",
        "category": category,
        "origin": origin,
    }
