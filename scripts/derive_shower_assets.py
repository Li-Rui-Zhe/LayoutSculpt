"""从项目原创 Blender 淋浴房网格拆出两种集成湿区，无需启动 Blender。

保留原花洒、软管、置物架、玻璃材质；移除整块背板和门框部件，
替换为低矮湿区地面。完整 Blender 源造型同时位于 tools/asset_bathroom.py。
"""
import json
from pathlib import Path

import numpy as np
import trimesh

from scripts.render_asset_thumbnails import render

ROOT = Path(__file__).resolve().parents[1]


def build(kind):
    folder = ROOT / "assets/furniture"
    source = trimesh.load(folder / "glb/shower.glb", force="scene")
    parts, tile = [], None
    for node in source.graph.nodes_geometry:
        transform, name = source.graph[node]
        mesh = source.geometry[name].copy()
        mesh.apply_transform(transform)
        material = mesh.visual.material
        label = material.name
        if "瓷板细缝" in label:
            continue
        if "暖灰瓷板" in label:
            tile = material.copy()
            continue
        # These materials have no image texture. Weld exporter UV/normal seams
        # to recover complete authored objects, never slice triangles mid-panel.
        mesh.merge_vertices(merge_tex=True, merge_norm=True)
        for part in mesh.split(only_watertight=False):
            low, high = part.bounds
            if "透明玻璃" in label:
                if kind == "shower_open" or high[0] > -.44:
                    continue
            if "暖白" in label and high[1] < .07:
                continue
            if "steel" in label and low[2] > .43 and low[1] > .1:
                continue  # Door hinges.
            if "哑黑铝框" in label and high[1] > .1:
                if (low[2] > .44 and not (kind == "shower_walk_in" and high[0] < -.44)) or low[0] > .44:
                    continue
                if kind == "shower_open" and high[0] < -.44:
                    continue
            if high[1] < .07:
                part.apply_translation([0, -.047, 0])  # Drain on the new floor.
            part.visual = trimesh.visual.TextureVisuals(material=material.copy())
            parts.append(part)
    if tile is None:
        raise RuntimeError("原淋浴房缺少瓷板材质，请检查来源模型")
    floor = trimesh.creation.box(extents=[1, .012, 1])
    floor.apply_translation([0, .006, 0])
    floor.visual = trimesh.visual.TextureVisuals(material=tile)
    parts.append(floor)
    bounds = np.array([part.bounds for part in parts])
    low, high = bounds[:, 0].min(axis=0), bounds[:, 1].max(axis=0)
    for part in parts:
        part.apply_translation([-(low[0] + high[0]) / 2, -low[1], -(low[2] + high[2]) / 2])
        part.apply_scale(np.array([1, 2.1, 1]) / (high - low))
    scene = trimesh.Scene()
    # Consolidate by material to keep draw calls small.
    groups = {}
    for part in parts:
        groups.setdefault(part.visual.material.name, []).append(part)
    for index, meshes in enumerate(groups.values()):
        mesh = trimesh.util.concatenate(meshes)
        mesh.visual = trimesh.visual.TextureVisuals(material=meshes[0].visual.material)
        scene.add_geometry(mesh, node_name=f"{kind}_{index}")
    path = folder / f"glb/{kind}.glb"
    path.write_bytes(scene.export(file_type="glb"))
    render(path, folder / f"thumbnails/{kind}.png")
    return {
        "id": f"habitat_{kind}", "kind": kind,
        "name": "单屏步入式淋浴区" if kind == "shower_walk_in" else "开放式淋浴花洒",
        "collection": f"asset_{kind}", "dimensions": [1, 1, 2.1],
        "triangles": sum(len(mesh.faces) for mesh in scene.geometry.values()),
        "category": "卫浴", "revision": "2.2.0", "generator": "python",
    }


if __name__ == "__main__":
    catalog_path = ROOT / "assets/furniture/catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    kinds = {"shower_walk_in", "shower_open"}
    additions = [build(kind) for kind in sorted(kinds)]
    catalog["items"] = [entry for entry in catalog["items"] if entry["kind"] not in kinds] + additions
    catalog["version"] = "2.2.0"
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    print("SHOWER_ASSETS_COMPLETE", len(additions))
