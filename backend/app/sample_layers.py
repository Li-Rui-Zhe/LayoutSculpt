"""Preserve shipped sample meshes as immutable local assets on copy.

Decorations are separate presentation layers: never counted as walls/rooms,
never used as recognition evidence, and explicitly editable in the UI.
"""
import hashlib
import io
import json
from collections import defaultdict
from pathlib import Path
from uuid import uuid4

import numpy as np
import trimesh
from shapely.geometry import Point, Polygon

from .library_models import save_snapshot, snapshot_file


def atomic_write(path, content):
    temporary = path.with_name(uuid4().hex + ".tmp")
    try:
        temporary.write_bytes(content)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def preserve_sample(document, source, library):
    raw = Path(source).read_bytes()
    cache = Path(library) / ("sample-" + hashlib.sha256(raw).hexdigest() + "-v2.json")
    if cache.exists():
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            if len(data["furniture_assets"]) != len(document["furniture"]):
                raise ValueError("示例家具缓存不完整")
            for ref in data["furniture_assets"] + [p["asset_id"] for p in data["presentation_layers"]]:
                snapshot_file(library, ref)
            for ref in data.get("floor_materials", {}).values():
                texture = Path(library).parent / "materials" / (ref.split(":")[1] + ".png")
                if not texture.exists():
                    raise ValueError("示例地板贴图缺失")
            return {**document, "presentation_layers": data["presentation_layers"],
                    "rooms": [{**r, **({"floor_material": data["floor_materials"][r["id"]]} if r["id"] in data.get("floor_materials", {}) else {})} for r in document["rooms"]],
                    "furniture": [{**item, "asset_id": ref} for item, ref in zip(document["furniture"], data["furniture_assets"])]}
        except (ValueError, KeyError, TypeError, OSError):
            pass
    scene = trimesh.load(io.BytesIO(raw), file_type="glb", force="scene")
    metadata = {child: edge.get("metadata", {}) for (_, child), edge in scene.graph.transforms.edge_data.items()}
    cx = (min(p["x"] for p in document["outline"]) + max(p["x"] for p in document["outline"]))/2
    cy = (min(p["y"] for p in document["outline"]) + max(p["y"] for p in document["outline"]))/2
    rooms = [(room, Polygon([(p["x"], p["y"]) for p in room["polygon"]])) for room in document["rooms"]]
    groups, furniture = defaultdict(trimesh.Scene), defaultdict(trimesh.Scene)
    floor_materials = {}
    for node in scene.graph.nodes_geometry:
        transform, geometry = scene.graph[node]
        meta = metadata.get(node, {})
        mesh = scene.geometry[geometry]
        if meta.get("structure_kind") == "room":
            image = getattr(getattr(mesh.visual, "material", None), "baseColorTexture", None)
            if image is not None:
                content = io.BytesIO()
                image.save(content, format="PNG")
                pixels = content.getvalue()
                digest = hashlib.sha256(pixels).hexdigest()
                folder = Path(library).parent / "materials"
                folder.mkdir(parents=True, exist_ok=True)
                atomic_write(folder / f"{digest}.png", pixels)
                meta_path = folder / f"{digest}.json"
                if not meta_path.exists():
                    atomic_write(meta_path, json.dumps({"name": "示例 · 原版地板纹理"}, ensure_ascii=False).encode("utf-8"))
                floor_materials[meta["room_id"]] = f"texture:{digest}"
        if "furniture_index" in meta:
            index = meta["furniture_index"]
            item = document["furniture"][index]
            pose = trimesh.transformations.translation_matrix([item["x"]-cx, .035+item.get("elevation",0), item["y"]-cy]) @ trimesh.transformations.rotation_matrix(-np.radians(item["rotation"]), [0,1,0])
            furniture[index].add_geometry(mesh.copy(), node_name=node, transform=np.linalg.inv(pose) @ transform)
            continue
        if (any(key in meta for key in ("structure_kind", "architecture_network", "opening_index"))
                or any(key.startswith("fixture_") for key in meta)
                or node.startswith(("未铺设地板的基层", "连续踢脚线"))):
            continue
        world_center = trimesh.transform_points([mesh.bounds.mean(axis=0)], transform)[0]
        point = Point(world_center[0]+cx, world_center[2]+cy)
        room = min(rooms, key=lambda pair: pair[1].distance(point))[0]
        key = (room["id"], room["name"], bool(meta.get("cutaway_upper")), bool(meta.get("cutaway_only")))
        groups[key].add_geometry(mesh.copy(), node_name=node, transform=transform)
    references = []
    for i in range(len(document["furniture"])):
        if not furniture[i].geometry:
            raise ValueError("示例家具缺少可编辑网格")
        ref, _ = save_snapshot(library, furniture[i].export(file_type="glb"))
        references.append(ref)
    layers = []
    for number, ((room_id, name, upper, only), group) in enumerate(groups.items()):
        low, high = group.bounds
        ref, _ = save_snapshot(library, group.export(file_type="glb"))
        layers.append({"id": f"sample-detail-{number}", "name": f"{name} · {'高处装饰' if upper else '剖切装饰' if only else '展示陈设'}",
                       "asset_id": ref, "x": float((low[0]+high[0])/2+cx), "y": float((low[2]+high[2])/2+cy),
                       "elevation": float(low[1]), "rotation": 0, "visible": True,
                       "cutaway_upper": upper, "cutaway_only": only})
    data = {"furniture_assets": references, "presentation_layers": layers, "floor_materials": floor_materials}
    cache.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(cache, json.dumps(data, ensure_ascii=False).encode("utf-8"))
    return {**document, "presentation_layers": layers,
            "rooms": [{**r, **({"floor_material": floor_materials[r["id"]]} if r["id"] in floor_materials else {})} for r in document["rooms"]],
            "furniture": [{**item, "asset_id": ref} for item, ref in zip(document["furniture"], references)]}


def add_presentation_layers(builder):
    for layer in builder.document.get("presentation_layers", []):
        if not layer.get("visible", True):
            continue
        source = trimesh.load(snapshot_file(builder.library_dir, layer["asset_id"]), force="scene")
        pose = trimesh.transformations.translation_matrix([layer["x"]-builder.cx, layer["elevation"], layer["y"]-builder.cz]) @ trimesh.transformations.rotation_matrix(-np.radians(layer.get("rotation",0)), [0,1,0])
        for i, node in enumerate(source.graph.nodes_geometry):
            transform, geometry = source.graph[node]
            builder.scene.add_geometry(source.geometry[geometry].copy(), node_name=f"陈设层_{layer['id']}_{i}", transform=pose @ transform,
                metadata={"presentation_layer_id": layer["id"], "cutaway_upper": layer.get("cutaway_upper", False), "cutaway_only": layer.get("cutaway_only", False)})
        builder.asset_hashes[layer["asset_id"]] = layer["asset_id"].split(":")[1]
