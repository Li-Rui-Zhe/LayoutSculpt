"""将锁定版本的 CC0 家具转换为离线 GLB。正常生成不访问外网。

python scripts/import_open_furniture.py [--only ph_sofa_02 ...]
源文件缓存在被忽略的 data/asset-sources；官方 API 校验和与来源随索引保存。
"""

import argparse
import hashlib
import json
import math
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.library_models import load_glb
from scripts.render_asset_thumbnails import render


def download(path, info):
    def valid(data):
        return (
            len(data) == info["size"] and hashlib.md5(data).hexdigest() == info["md5"]
        )

    if path.exists() and valid(path.read_bytes()):
        return
    request = Request(
        info["url"], headers={"User-Agent": "LayoutSculpt/1.0 (CC0 furniture build)"}
    )
    with urlopen(request, timeout=60) as response:
        data = response.read(info["size"] + 1)
    if not valid(data):
        raise ValueError(f"源文件校验失败：{path.name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def convert(source, yaw=0):
    scene = trimesh.load(source, force="scene")
    clean = trimesh.Scene()
    for i, node in enumerate(scene.graph.nodes_geometry):
        transform, key = scene.graph[node]
        mesh = scene.geometry[key].copy()
        mesh.apply_transform(transform)
        # 保留源 UV、法线与 PBR；不按目标外廓逐轴拉伸。
        mesh.apply_transform(
            trimesh.transformations.rotation_matrix(math.radians(yaw), [0, 1, 0])
        )
        clean.add_geometry(mesh, node_name=f"part_{i}", geom_name=f"part_{i}")
    low, high = clean.bounds
    offset = np.array([(low[0] + high[0]) / 2, low[1], (low[2] + high[2]) / 2])
    clean.apply_translation(-offset)
    payload = clean.export(file_type="glb")
    checked = load_glb(payload)
    triangles = sum(len(m.faces) for m in checked.geometry.values())
    if triangles > 100_000 or len(payload) > 8 * 1024 * 1024:
        raise ValueError("资产超过实时预览预算，不能直接发布")
    if not np.isfinite(checked.bounds).all() or abs(checked.bounds[0, 1]) > 1e-5:
        raise ValueError("模型几何或底面无效")
    return payload, checked.extents[[0, 2, 1]].tolist(), triangles


def build(only=None):
    folder = ROOT / "assets/furniture"
    manifest = json.loads(
        (folder / "external-sources.json").read_text(encoding="utf-8")
    )
    catalog = json.loads((folder / "catalog.json").read_text(encoding="utf-8"))
    entries = {item["kind"]: item for item in catalog["items"]}
    selected = [item for item in manifest["items"] if not only or item["key"] in only]
    if only and set(only) - {item["key"] for item in selected}:
        raise ValueError("未知的开放家具编号")
    with tempfile.TemporaryDirectory(prefix="layoutsculpt-cc0-") as temp:
        stage = Path(temp)
        for item in selected:
            cache = ROOT / "data/asset-sources/polyhaven" / item["asset"]
            for relative, info in item["files"].items():
                target = (cache / relative).resolve()
                if not target.is_relative_to(cache.resolve()):
                    raise ValueError("源路径必须位于单素材缓存内")
                download(target, info)
            payload, size, count = convert(
                cache / (item["asset"] + ".gltf"), item["yaw_degrees"]
            )
            key = item["key"]
            (stage / f"{key}.glb").write_bytes(payload)
            render(stage / f"{key}.glb", stage / f"{key}.png", size=384)
            entries[key] = {
                "id": f"habitat_{key}",
                "kind": key,
                "name": item["name"],
                "furniture_kind": item["furniture_kind"],
                "dimensions": size,
                "category": item["category"],
                "family": item["family"],
                "variant": item["variant"],
                "style": "实景质感",
                "styles": item["styles"],
                "rooms": [item["category"]],
                "tags": [item["category"], item["family"], item["variant"], "精细模型"],
                "description": f"{item['variant']}，保留完整纹理与真实比例。尺寸为模型外廓，用于布局参考，非具体商品采购规格。",
                "revision": "3.4.0",
                "generator": "external",
                "source": "scripts/import_open_furniture.py",
                "source_url": item["source_url"],
                "authors": item["authors"],
                "license": item["license"],
                "license_url": manifest["license_url"],
                "format": "glb",
                "triangles": count,
                "sha256": hashlib.sha256(payload).hexdigest(),
                "quality_tier": "detailed",
            }
            print(
                f"{key}: {size}, {count} triangles, {len(payload) // 1024} KB",
                flush=True,
            )
        for item in selected:
            for extension, directory in [("glb", "glb"), ("png", "thumbnails")]:
                shutil.copyfile(
                    stage / f"{item['key']}.{extension}",
                    folder / directory / f"{item['key']}.{extension}",
                )
        catalog.update(
            version="3.4.0",
            items=sorted(entries.values(), key=lambda e: e["kind"]),
            license="原创家具与开放授权家具；外部模型、纹理的许可和来源见各项记录及 THIRD_PARTY.md。",
        )
        pending = folder / "catalog.json.tmp"
        pending.write_text(
            json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        pending.replace(folder / "catalog.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="+")
    build(parser.parse_args().only)
