"""在真实 Blender 中校验资产原点、尺寸、材质，以及生成工程的实例缩放。"""

import argparse
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def bounds(obj):
    points = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    return low, high


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    root = Path(__file__).resolve().parents[1]
    catalog = json.loads(
        (root / "assets/furniture/catalog.json").read_text(encoding="utf-8")
    )
    bpy.ops.wm.open_mainfile(
        filepath=str(root / "assets/furniture" / catalog["library"]), use_scripts=False
    )
    for item in catalog["items"]:
        obj = bpy.data.collections[item["collection"]].objects[0]
        assert all(
            abs(obj.dimensions[i] - item["dimensions"][i]) < 0.001 for i in range(3)
        ), item["id"]
        assert obj.data.uv_layers and all(
            slot.material.get("asset_role") for slot in obj.material_slots
        )
    workspace = Path(args.workspace)
    doc = json.loads((workspace / "layout.json").read_text(encoding="utf-8"))
    bpy.ops.wm.open_mainfile(filepath=str(workspace / "model.blend"), use_scripts=False)
    bpy.context.view_layer.update()
    instances = [o for o in bpy.context.scene.objects if o.get("asset_id")]
    assert len(instances) == len(doc["furniture"]), "家具未全部使用预制资产"
    midx = (
        min(p["x"] for p in doc["outline"]) + max(p["x"] for p in doc["outline"])
    ) / 2
    midy = (
        min(p["y"] for p in doc["outline"]) + max(p["y"] for p in doc["outline"])
    ) / 2
    for index, item in enumerate(doc["furniture"], 1):
        obj = next(o for o in instances if o.name.endswith(f"_{index}"))
        assert (
            obj.location - Vector((item["x"] - midx, -item["y"] + midy, 0.035))
        ).length < 0.001
        # 旋转前的局部网格尺寸乘缩放必须精确匹配米制契约。
        local = [Vector(p) for p in obj.bound_box]
        for i, key in enumerate(["width", "depth", "height"]):
            extent = max(p[i] for p in local) - min(p[i] for p in local)
            assert abs(extent * obj.scale[i] - item[key]) < 0.001, (obj.name, key)
    textured = [
        slot.material
        for obj in instances
        for slot in obj.material_slots
        if slot.material
        and slot.material.use_nodes
        and any(n.type == "TEX_IMAGE" for n in slot.material.node_tree.nodes)
    ]
    assert textured, "家具贴图缺失"
    assert all(
        n.image.packed_file
        for m in textured
        for n in m.node_tree.nodes
        if n.type == "TEX_IMAGE"
    ), "工程有未打包贴图"
    print("FURNITURE_VALIDATION_OK", len(catalog["items"]), len(instances))


if __name__ == "__main__":
    main()
