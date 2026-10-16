"""可放置 GLB 的规范化和不可变副本；调用方不能传入文件路径。"""

import hashlib
import io
import json
import re
import struct
from pathlib import Path

import numpy as np
import trimesh
from .glb_limits import validate_glb_budget


def load_glb(data):
    if len(data) > 100 * 1024 * 1024:
        raise ValueError("单个家具模型不能超过 100 MB")
    if len(data) < 20 or data[:4] != b"glTF":
        raise ValueError("不是有效的 GLB 模型")
    _, version, length, size, kind = struct.unpack_from("<4sIIII", data)
    if version != 2 or length != len(data) or kind != 0x4E4F534A:
        raise ValueError("GLB 文件结构不完整")
    if size > 4 * 1024 * 1024 or 20 + size > len(data):
        raise ValueError("GLB 索引过大或不完整")
    document = json.loads(data[20 : 20 + size])
    for item in document.get("buffers", []) + document.get("images", []):
        if item.get("uri") and not item["uri"].startswith("data:"):
            raise ValueError("请使用内嵌纹理和几何数据的 GLB")
    try:
        validate_glb_budget(document, data, size)
        scene = trimesh.load(io.BytesIO(data), file_type="glb", force="scene")
    except (KeyError, IndexError, TypeError, RecursionError, OSError, struct.error) as exc:
        raise ValueError("模型结构或贴图无效，请重新导出标准 GLB") from exc
    bounds = scene.bounds
    if bounds is None or not np.isfinite(bounds).all():
        raise ValueError("模型没有有效几何体")
    size = bounds[1] - bounds[0]
    if (size < 1e-5).any():
        raise ValueError("模型必须具有有效的宽、深、高")
    return scene


def normalize_glb(data):
    source = load_glb(data)
    bounds = source.bounds
    offset = [
        (bounds[0, 0] + bounds[1, 0]) / 2,
        bounds[0, 1],
        (bounds[0, 2] + bounds[1, 2]) / 2,
    ]
    scene = trimesh.Scene()
    for index, node in enumerate(source.graph.nodes_geometry):
        transform, geometry = source.graph[node]
        mesh = source.geometry[geometry].copy()
        mesh.apply_transform(transform)
        mesh.apply_translation(-np.array(offset))
        scene.add_geometry(mesh, node_name=f"part_{index}", geom_name=f"part_{index}")
    return scene.export(file_type="glb"), (bounds[1] - bounds[0])[[0, 2, 1]].tolist()


def snapshot_file(root, asset_id):
    if not re.fullmatch(r"snapshot:[a-f0-9]{64}", asset_id or ""):
        raise ValueError("素材引用无效，请从素材库重新选择")
    path = Path(root) / f"{asset_id.split(':')[1]}.glb"
    if not path.is_file():
        raise ValueError("家具副本不存在，请从素材库重新选择")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != asset_id.split(":")[1]:
        raise ValueError("家具副本校验失败，请从素材库重新选择")
    return path


def save_snapshot(root, data):
    normalized, dimensions = normalize_glb(data)
    digest = hashlib.sha256(normalized).hexdigest()
    folder = Path(root)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{digest}.glb"
    if not path.exists():
        # 独立临时文件，替换为同内容地址；并发不会读到半写入的 GLB。
        from uuid import uuid4

        temporary = folder / f"{uuid4().hex}.tmp"
        try:
            temporary.write_bytes(normalized)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return f"snapshot:{digest}", dimensions
