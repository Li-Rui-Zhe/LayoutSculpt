"""Blender 后台入口：读取经过校验的 layout.json，只生成几何，不执行模型返回的代码。"""

import argparse
import json
import math
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from asset_materials import palette_materials, manual_materials
from furniture_library import FurnitureLibrary


def box(name, location, size, mat, bevel=0.025, rotation=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    obj.rotation_euler[2] = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("圆角", "BEVEL")
        modifier.width = min(bevel, min(size) / 3)
        modifier.segments = 3
        obj.modifiers.new("加权法线", "WEIGHTED_NORMAL")
    return obj


def sphere(name, location, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return obj


def cylinder(name, location, radius, depth, mat):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=24, radius=radius, depth=depth, location=location
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    mod = obj.modifiers.new("圆角", "BEVEL")
    mod.width = 0.01
    mod.segments = 2
    obj.modifiers.new("加权法线", "WEIGHTED_NORMAL")
    return obj


def polygon_slab(name, points, z, depth, mat):
    verts = [(p["x"], -p["y"], z) for p in points]
    indices = list(range(len(points)))
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(verts, verts[1:] + verts[:1]))
    if area < 0:
        indices.reverse()
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], [indices])
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        point = mesh.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (point.x / 2, point.y / 2)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    solid = obj.modifiers.new("厚度", "SOLIDIFY")
    solid.thickness = depth
    solid.offset = -1
    bevel = obj.modifiers.new("边缘", "BEVEL")
    bevel.width = 0.015
    bevel.segments = 2
    obj.modifiers.new("三角化", "TRIANGULATE")


def make_furniture(item, mats):
    w, d, h = item["width"], item["depth"], item["height"]
    kind = item["kind"]
    before = set(bpy.data.objects)
    wood, cream, accent = mats["wood"], mats["fabric"], mats["accent"]
    b = lambda name, loc, size, mat, bevel=0.025: box(name, loc, size, mat, bevel)
    if kind == "bed":
        b("床架", (0, 0, 0.21), (w, d, 0.3), wood, 0.07)
        b("床垫", (0, 0, 0.46), (w, d * 0.97, 0.22), cream, 0.09)
        b("被子", (0, -d * 0.15, 0.61), (w * 0.99, d * 0.60, 0.15), cream, 0.08)
        b("床头", (0, d * 0.47, h / 2 + 0.08), (w, 0.12, max(h, 0.65)), accent, 0.07)
        for x in [-w * 0.24, w * 0.24]:
            b("枕头", (x, d * 0.30, 0.64), (w * 0.42, d * 0.19, 0.16), cream, 0.08)
        b("床尾毯", (0, -d * 0.27, 0.70), (w, d * 0.20, 0.025), accent, 0.01)
    elif kind == "sofa":
        b("沙发底座", (0, 0, 0.26), (w, d, 0.25), wood, 0.08)
        b("沙发坐垫", (0, -d * 0.06, 0.47), (w * 0.87, d * 0.83, 0.24), cream, 0.10)
        b("沙发靠背", (0, d * 0.39, h * 0.64), (w, d * 0.22, h * 0.63), cream, 0.1)
        for x in [-w * 0.455, w * 0.455]:
            b("沙发扶手", (x, 0, h * 0.5), (w * 0.10, d, h * 0.65), cream, 0.07)
        for x in [-w * 0.28, w * 0.28]:
            b(
                "抱枕",
                (x, d * 0.19, h * 0.71),
                (min(0.45, w * 0.24), 0.16, min(0.45, h * 0.5)),
                accent,
                0.07,
            )
    elif kind in {"table", "desk"}:
        b("桌面", (0, 0, h - 0.055), (w, d, 0.10), wood, 0.04)
        for x in [-w * 0.39, w * 0.39]:
            for y in [-d * 0.35, d * 0.35]:
                b("桌腿", (x, y, (h - 0.1) / 2), (0.045, 0.045, h - 0.1), wood, 0.007)
        if kind == "table":
            cylinder("花瓶", (0, 0, h + 0.08), min(w, d) * 0.08, 0.16, mats["white"])
    elif kind == "chair":
        b("椅垫", (0, 0, h * 0.5), (w, d, 0.08), cream, 0.04)
        b("椅背", (0, d * 0.40, h * 0.78), (w, 0.07, h * 0.4), wood, 0.03)
        for x in [-w * 0.37, w * 0.37]:
            for y in [-d * 0.34, d * 0.34]:
                b("椅脚", (x, y, h * 0.25), (0.035, 0.035, h * 0.5), wood, 0.004)
    elif kind in {"cabinet", "counter"}:
        b("柜体", (0, 0, h / 2), (w, d, h), wood)
        b("台面", (0, 0, h + 0.02), (w + 0.015, d + 0.015, 0.045), mats["stone"], 0.012)
        count = max(1, round(w / 0.55))
        for i in range(count):
            x = -w / 2 + (i + 0.5) * w / count
            b(
                "柜门",
                (x, -d / 2 - 0.005, h / 2),
                (w / count - 0.016, 0.025, h * 0.9),
                wood,
                0.005,
            )
            b(
                "把手",
                (x, -d / 2 - 0.027, h * 0.75),
                (min(0.15, w / count * 0.5), 0.018, 0.014),
                mats["metal"],
                0.003,
            )
    elif kind == "bathtub":
        b("浴缸底", (0, 0, 0.14), (w, d, 0.22), mats["white"], 0.12)
        for x in [-w / 2 + 0.065, w / 2 - 0.065]:
            b("浴缸侧边", (x, 0, h / 2), (0.13, d, h), mats["white"], 0.055)
        for y in [-d / 2 + 0.065, d / 2 - 0.065]:
            b("浴缸端边", (0, y, h / 2), (w, 0.13, h), mats["white"], 0.055)
        b(
            "水面",
            (0, 0, h * 0.49),
            (max(0.05, w - 0.26), max(0.05, d - 0.26), 0.015),
            mats["glass"],
            0.01,
        )
    elif kind == "toilet":
        sphere(
            "马桶底座", (0, 0, h * 0.32), (w * 0.36, d * 0.33, h * 0.32), mats["white"]
        )
        sphere(
            "马桶盖",
            (0, -d * 0.12, h * 0.62),
            (w * 0.48, d * 0.39, h * 0.08),
            mats["white"],
        )
        b(
            "水箱",
            (0, d * 0.32, h * 0.64),
            (w * 0.85, d * 0.25, h * 0.62),
            mats["white"],
            0.06,
        )
    elif kind == "sink":
        b("洗手柜", (0, 0, h * 0.44), (w, d, h * 0.86), wood)
        b("洗手台面", (0, 0, h * 0.89), (w, d, 0.06), mats["white"])
        sphere("台盆", (0, 0, h * 0.94), (w * 0.35, d * 0.34, 0.065), mats["white"])
        cylinder("水龙头", (0, d * 0.35, h + 0.03), 0.019, 0.18, mats["metal"])
    elif kind == "plant":
        cylinder("花盆", (0, 0, h * 0.16), min(w, d) * 0.28, h * 0.32, mats["white"])
        for j in range(8):
            angle = j * 2.4
            r = min(w, d) * 0.27
            z = h * (0.4 + 0.06 * j)
            cylinder("枝干", (0, 0, z * 0.5), 0.009, z, wood)
            leaf = sphere(
                "叶片",
                (math.cos(angle) * r, math.sin(angle) * r, z),
                (0.06, min(w, d) * 0.22, 0.025),
                mats["leaf"],
            )
            leaf.rotation_euler = (0.35, 0.3, angle)
    elif kind == "rug":
        b("地毯", (0, 0, 0.025), (w, d, 0.035), accent, 0.02)
    for obj in set(bpy.data.objects) - before:
        angle = -math.radians(item["rotation"])
        x, y = obj.location.x, obj.location.y
        obj.location.x = item["x"] + math.cos(angle) * x - math.sin(angle) * y
        obj.location.y = -item["y"] + math.sin(angle) * x + math.cos(angle) * y
        obj.location.z += 0.035
        obj.rotation_euler[2] += angle


def make_light_fixture(fixture, mats):
    x, y, z = fixture["x"], -fixture["y"], fixture["elevation"]
    colors = {
        2700: (1.0, 0.65, 0.32),
        3000: (1.0, 0.76, 0.48),
        4000: (1.0, 0.89, 0.73),
        6500: (0.88, 0.94, 1.0),
    }
    color = colors[fixture["temperature"]]
    mat = bpy.data.materials.new("灯泡_" + fixture["id"])
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Emission Color"].default_value = (*color, 1)
    bsdf.inputs["Emission Strength"].default_value = (
        2 if fixture["enabled"] and fixture["lumens"] > 0 else 0
    )
    obj = sphere("灯泡_" + fixture["name"], (x, y, z), (0.09, 0.09, 0.10), mat)
    obj["fixture_id"] = fixture["id"]
    obj["fixture_lumens"] = fixture["lumens"]
    obj["fixture_temperature"] = fixture["temperature"]
    obj["fixture_enabled"] = fixture["enabled"]
    if fixture["kind"] == "floor_lamp":
        cylinder("落地灯底座", (x, y, 0.05), 0.22, 0.08, mats["metal"])
        cylinder("落地灯灯杆", (x, y, z / 2), 0.018, max(0.1, z - 0.12), mats["metal"])
        cylinder("落地灯顶罩", (x, y, z + 0.16), 0.24, 0.055, mats["wood"])
    elif fixture["kind"] == "pendant":
        cylinder("吊灯顶罩", (x, y, z + 0.15), 0.23, 0.045, mats["metal"])
        cylinder("吊灯吊线", (x, y, z + 0.28), 0.009, 0.25, mats["metal"])
    else:
        cylinder("灯泡底座", (x, y, z + 0.13), 0.06, 0.08, mats["metal"])
    # .blend 自带真实光源；GLB 用灯泡 extras 在 Three.js 恢复同位置光源。
    light = bpy.data.lights.new("光源_" + fixture["name"], "POINT")
    light.energy = fixture["lumens"] / 80 if fixture["enabled"] else 0
    light.color = color
    light.shadow_soft_size = 0.12
    source = bpy.data.objects.new(light.name, light)
    source.location = (x, y, z)
    bpy.context.collection.objects.link(source)


def build(document, output, catalog_path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    style = document.get("style", "natural")
    mats = palette_materials(style)
    finishes = manual_materials(mats)
    mode = document.get("furniture_mode", "library")
    library = FurnitureLibrary(catalog_path, mats) if mode == "library" else None
    fallback = []
    outline = document["outline"]
    xs = [p["x"] for p in outline]
    ys = [p["y"] for p in outline]
    midx = (min(xs) + max(xs)) / 2
    midy = (min(ys) + max(ys)) / 2
    polygon_slab("建筑基座", outline, -0.04, 0.28, mats["base"])
    polygon_slab("未铺设地板的基层", outline, 0.015, 0.065, mats["base"])
    for room in document["rooms"]:
        if not room.get("floor_enabled", True):
            continue
        floor_mat = finishes.get(room.get("floor_finish")) or (
            mats["stone"]
            if room["kind"] in {"bathroom", "kitchen", "balcony"}
            else mats["floor"]
        )
        polygon_slab(
            room["name"],
            room["polygon"],
            0.028,
            0.015,
            floor_mat,
        )
    for wall in document["walls"]:
        a, b = wall["start"], wall["end"]
        dx = b["x"] - a["x"]
        dy = b["y"] - a["y"]
        length = math.hypot(dx, dy)
        angle = math.atan2(-dy, dx)
        cx = (a["x"] + b["x"]) / 2
        cy = (a["y"] + b["y"]) / 2
        cut = wall["exterior"] and (cy > midy + 0.3 or cx > midx + 0.3)
        height = min(wall["height"], 0.8) if cut else wall["height"]

        def segment(start, end, bottom, top):
            if end - start < 0.005 or top - bottom < 0.005:
                return
            t = (start + end) / 2 / length
            box(
                "墙体_" + wall["id"],
                (a["x"] + dx * t, -a["y"] - dy * t, (top + bottom) / 2),
                (end - start, wall["thickness"], top - bottom),
                finishes.get("wall_" + wall.get("finish", "default"), mats["wall"]),
                0.012,
                angle,
            )

        openings = sorted(
            [o for o in document["openings"] if o["wall_id"] == wall["id"]],
            key=lambda o: o["offset"],
        )
        cursor = 0
        for opening in openings:
            start, end = opening["offset"], opening["offset"] + opening["width"]
            segment(cursor, start, 0, height)
            bottom = min(opening["bottom"], height)
            top = min(opening["bottom"] + opening["height"], height)
            segment(start, end, 0, bottom)
            segment(start, end, top, height)
            if opening["kind"] == "door" and opening.get("door_leaf", True):
                # 数据坐标 Y 向下，Blender Y 向上；铰链与平面图使用同一旋转约定。
                at_end = opening.get("hinge", "start") == "end"
                offset = end if at_end else start
                hx, hy = a["x"] + dx * offset / length, -a["y"] - dy * offset / length
                leaf_angle = (
                    angle
                    + (math.pi if at_end else 0)
                    + math.radians(opening.get("angle", 90))
                    * (1 if opening.get("swing", "left") == "left" else -1)
                )
                width = max(0.03, opening["width"] - 0.04)
                box(
                    "门扇_" + wall["id"],
                    (
                        hx + math.cos(leaf_angle) * width / 2,
                        hy + math.sin(leaf_angle) * width / 2,
                        opening["height"] / 2,
                    ),
                    (width, 0.035, opening["height"] - 0.02),
                    mats["wood"],
                    0.008,
                    leaf_angle,
                )
            if opening["kind"] == "window" and top > bottom + 0.05:
                t = (start + end) / 2 / length
                px, py = a["x"] + dx * t, -a["y"] - dy * t
                box(
                    "窗玻璃",
                    (px, py, (bottom + top) / 2),
                    (end - start, 0.025, top - bottom),
                    mats["glass"],
                    0.002,
                    angle,
                )
                for offset in [start, end, (start + end) / 2]:
                    t = offset / length
                    box(
                        "窗框",
                        (a["x"] + dx * t, -a["y"] - dy * t, (top + bottom) / 2),
                        (0.035, 0.065, top - bottom),
                        mats["metal"],
                        0.002,
                        angle,
                    )
            cursor = max(cursor, end)
        segment(cursor, length, 0, height)
    for item in document["furniture"]:
        if library and library.place(item):
            continue
        make_furniture(item, mats)
        if library:
            fallback.append(item["kind"])
    for fixture in document.get("lights", []):
        make_light_fixture(fixture, mats)
    # 保留米制尺寸，只平移原点；浏览器按包围盒自动取景。
    for obj in bpy.context.scene.objects:
        obj.location.x -= midx
        obj.location.y += midy
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.ops.file.pack_all()
    report = {
        "mode": mode,
        "blender_version": bpy.app.version_string,
        "total": len(document["furniture"]),
        "fallback": fallback,
        **(library.report() if library else {"matched": 0}),
    }
    (output / "furniture-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "model.blend"))
    bpy.ops.export_scene.gltf(
        filepath=str(output / "model.glb"),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_extras=True,
    )
    print("MODEL_COMPLETE", len(bpy.data.objects))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--layout", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--asset-catalog",
        default=str(
            Path(__file__).resolve().parents[1] / "assets/furniture/catalog.json"
        ),
    )
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    build(
        json.loads(Path(args.layout).read_text(encoding="utf-8")),
        output,
        args.asset_catalog,
    )
