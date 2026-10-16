"""家具参考图：保持长宽比例，剥离元数据，使用不可变内容编号。"""

import hashlib
import io
import re
import warnings
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_REFERENCE_BYTES = 10 * 1024 * 1024


def reference_path(settings, identifier):
    if not re.fullmatch(r"[a-f0-9]{64}", identifier):
        raise ValueError("参考图片编号无效，请重新上传")
    path = settings.data_dir / "diy_references" / f"{identifier}.png"
    if not path.is_file():
        raise ValueError("参考图片不存在，请重新上传")
    return path


def save_reference(settings, content):
    if len(content) > MAX_REFERENCE_BYTES:
        raise ValueError("参考图片不能超过 10 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as original:
                if original.format not in {"PNG", "JPEG", "WEBP"}:
                    raise ValueError("参考图片仅支持 PNG、JPG 或 WebP")
                if original.width * original.height > 16_000_000:
                    raise ValueError("参考图片不能超过 1600 万像素")
                image = ImageOps.exif_transpose(original).convert("RGBA")
                image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
                canvas = Image.new("RGBA", image.size, "white")
                canvas.alpha_composite(image)
                output = io.BytesIO()
                canvas.convert("RGB").save(output, format="PNG")
    except (
        OSError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise ValueError("无法读取参考图片，请选择有效的 PNG、JPG 或 WebP") from exc
    data = output.getvalue()
    identifier = hashlib.sha256(data).hexdigest()
    folder = settings.data_dir / "diy_references"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{identifier}.png"
    if not target.exists():
        temporary = folder / f"{uuid4().hex}.tmp"
        try:
            temporary.write_bytes(data)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    return {
        "id": identifier,
        "url": f"/api/diy/references/{identifier}.png",
        "width": canvas.width,
        "height": canvas.height,
    }
