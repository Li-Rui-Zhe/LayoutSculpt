"""导入 ambientCG CC0 扫描贴图。发布文件离线使用，来源与 SHA256 可追溯。"""

import hashlib
import io
import json
import zipfile
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "assets/materials/pbr"


def build():
    TARGET.mkdir(parents=True, exist_ok=True)
    manifest_path = TARGET / "sources.json"
    previous = (
        json.loads(manifest_path.read_text("utf-8")) if manifest_path.exists() else {}
    )
    manifest = {}
    for source, key in [("Fabric030", "fabric"), ("Wood051", "wood")]:
        url = f"https://ambientcg.com/get?file={source}_1K-JPG.zip"
        cache = ROOT / "data/asset-sources/ambientcg" / f"{source}.zip"
        if not cache.exists():
            cache.parent.mkdir(parents=True, exist_ok=True)
            with urlopen(
                Request(url, headers={"User-Agent": "LayoutSculpt/1.0"}), timeout=90
            ) as response:
                cache.write_bytes(response.read(32 * 1024 * 1024))
        payload = cache.read_bytes()
        digest = hashlib.sha256(payload).hexdigest()
        if key in previous and digest != previous[key]["source_sha256"]:
            raise ValueError(f"{source} 源文件发生变化，请人工核对版本")
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:

            def read(suffix):
                name = next(
                    n for n in archive.namelist() if n.endswith(f"_{suffix}.jpg")
                )
                return (
                    Image.open(io.BytesIO(archive.read(name)))
                    .convert("RGB")
                    .resize((512, 512), Image.Resampling.LANCZOS)
                )

            color = read("Color")
            # 中性亮度保存实拍细节，家具的底色由材质因子决定。
            values = np.asarray(color.convert("L"), dtype=float)
            values = np.clip(
                230 + (values - np.mean(values)) * (0.65 if key == "fabric" else 1.1),
                140,
                255,
            ).astype("uint8")
            Image.fromarray(values).convert("RGB").save(
                TARGET / f"{key}_color.jpg", quality=93
            )
            normal = np.asarray(read("NormalGL"), dtype=float).copy()
            normal[:, :, :2] = 128 + (normal[:, :, :2] - 128) * (
                0.35 if key == "fabric" else 0.22
            )
            Image.fromarray(normal.clip(0, 255).astype("uint8")).save(
                TARGET / f"{key}_normal.png"
            )
            rough = np.asarray(read("Roughness").convert("L"))
            packed = np.zeros((*rough.shape, 3), dtype="uint8")
            packed[:, :, 0] = 255
            packed[:, :, 1] = rough
            Image.fromarray(packed).save(TARGET / f"{key}_roughness.png")
        outputs = {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in TARGET.glob(f"{key}_*")
        }
        manifest[key] = {
            "asset": source,
            "source_url": f"https://ambientcg.com/a/{source}",
            "download_url": url,
            "license": "CC0-1.0",
            "license_url": "https://docs.ambientcg.com/license/",
            "source_sha256": digest,
            "outputs": outputs,
            "modifications": "512px；中性色图；减弱 OpenGL 法线；粗糙度打包为 glTF G 通道，B=0",
        }
        print(f"已导入 {source}", flush=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8"
    )


if __name__ == "__main__":
    build()
