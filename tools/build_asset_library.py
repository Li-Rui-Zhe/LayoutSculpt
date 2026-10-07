"""离线构建造个家原创家具库。只在资产更新时运行；户型生成直接追加保存的网格。"""

import json
import math
from pathlib import Path
import sys
import hashlib

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from asset_materials import PALETTES, SURFACES, TEXTURES, palette_materials
from build_from_layout import box, cylinder, sphere

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "assets" / "furniture"
VERSION = "1.0.0"
SPECS = {
    "sofa": ("云屿三人沙发", (2.3, 0.95, 0.88)),
    "bed": ("栖木软包双人床", (1.8, 2.1, 1.1)),
    "cabinet": ("木格双门衣柜", (1.6, 0.6, 2.15)),
    "table": ("圆角实木餐桌", (1.5, 0.85, 0.76)),
    "chair": ("弧背布艺餐椅", (0.5, 0.54, 0.84)),
    "desk": ("抽屉工作书桌", (1.3, 0.62, 0.76)),
    "counter": ("石面厨房地柜", (1.8, 0.6, 0.9)),
    "rug": ("编织流苏地毯", (2.0, 1.5, 0.035)),
    "plant": ("陶盆橄榄树", (0.7, 0.7, 1.3)),
    "sink": ("台盆浴室柜", (0.8, 0.5, 0.95)),
    "toilet": ("圆润一体坐便器", (0.4, 0.68, 0.76)),
    "bathtub": ("独立椭圆浴缸", (0.78, 1.65, 0.6)),
}


def save_texture(name, rgb):
    image = bpy.data.images.new(name, width=rgb.shape[1], height=rgb.shape[0])
    rgba = np.concatenate(
        [np.clip(rgb, 0, 1), np.ones((*rgb.shape[:2], 1))], axis=2
    ).astype(np.float32)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(TEXTURES / name)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def textures():
    TEXTURES.mkdir(parents=True, exist_ok=True)
    n = 512
    y, x = np.mgrid[0:n, 0:n] / n
    rng = np.random.default_rng(41)
    noise = rng.random((n, n))
    grain = np.sin(
        2
        * math.pi
        * (x * 45 + 0.6 * np.sin(y * 2 * math.pi) + 0.18 * np.sin(y * 6 * math.pi))
    )
    wood = 0.86 + 0.07 * grain + 0.03 * noise
    seams = ((x * 5) % 1 < 0.012) | (((y + np.floor(x * 5) * 0.31) % 1) < 0.012)
    heights = {
        "wood": wood,
        "planks": np.where(seams, 0.44, wood),
        "linen": 0.85
        + 0.07 * np.sin(x * math.pi * 256) * np.sin(y * math.pi * 256)
        + 0.03 * noise,
        "stone": 0.88 + 0.035 * noise + 0.025 * np.sin((x * 3 + y * 2) * math.pi * 2),
    }
    for surface, height in heights.items():
        save_texture(f"{surface}_color.png", np.repeat(height[:, :, None], 3, axis=2))
        dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 2
        dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 2
        normal = np.stack([-dx, -dy, np.ones_like(dx)], axis=2)
        normal /= np.linalg.norm(normal, axis=2)[:, :, None]
        save_texture(f"{surface}_normal.png", normal * 0.5 + 0.5)
    for style, palette in PALETTES.items():
        for role, surface in SURFACES.items():
            # 输入为线性色值，PNG 储存用于 glTF 的 sRGB 颜色。
            color = np.array(palette.get(role, (0.76, 0.75, 0.70))) ** (1 / 2.2)
            save_texture(
                f"{style}_{role}_color.png", heights[surface][:, :, None] * color
            )


def pipe(name, points, radius, mat, cyclic=False):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    line = curve.splines.new("POLY")
    line.points.add(len(points) - 1)
    for p, xyz in zip(line.points, points):
        p.co = (*xyz, 1)
    line.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def seam(name, x, y, z, w, d, mat):
    r = min(w, d) * 0.12
    points = []
    for cx, cy, start in [
        (x + w / 2 - r, y + d / 2 - r, 0),
        (x - w / 2 + r, y + d / 2 - r, 90),
        (x - w / 2 + r, y - d / 2 + r, 180),
        (x + w / 2 - r, y - d / 2 + r, 270),
    ]:
        for a in range(0, 91, 15):
            t = math.radians(start + a)
            points.append((cx + r * math.cos(t), cy + r * math.sin(t), z))
    return pipe(name, points, 0.004, mat, True)


def vessel(name, profile, mat, sx=1, sy=1):
    vertices, faces, steps = [], [], 64
    for radius, z in profile:
        for i in range(steps):
            t = 2 * math.pi * i / steps
            vertices.append((sx * radius * math.cos(t), sy * radius * math.sin(t), z))
    for j in range(len(profile) - 1):
        for i in range(steps):
            a, b = j * steps + i, j * steps + (i + 1) % steps
            faces.append((a, b, b + steps, a + steps))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for face in mesh.polygons:
        face.use_smooth = True
    return obj


def construct(kind, m):
    wood, fabric, accent, metal = m["wood"], m["fabric"], m["accent"], m["metal"]
    if kind == "sofa":
        box("悬浮木底座", (0, 0, 0.22), (2.26, 0.9, 0.15), wood, 0.045)
        for x in [-0.91, 0.91]:
            for y in [-0.32, 0.32]:
                cylinder("金属细脚", (x, y, 0.095), 0.026, 0.19, metal)
        for x in [-0.69, 0, 0.69]:
            box("独立坐垫", (x, -0.055, 0.39), (0.67, 0.75, 0.22), fabric, 0.095)
            seam("坐垫滚边", x, -0.055, 0.47, 0.61, 0.69, fabric)
            back = box("分体靠背", (x, 0.32, 0.67), (0.68, 0.23, 0.40), fabric, 0.10)
            back.rotation_euler.x = -0.12
        for x in [-1.05, 1.05]:
            box("饱满扶手", (x, 0, 0.52), (0.2, 0.91, 0.41), fabric, 0.09)
        for x, angle in [(-0.7, -0.16), (0.65, 0.19)]:
            pillow = box("柔软抱枕", (x, 0.12, 0.66), (0.39, 0.18, 0.36), accent, 0.08)
            pillow.rotation_euler = (-0.22, angle, angle)
    elif kind == "bed":
        for x in [-0.72, 0.72]:
            for y in [-0.78, 0.78]:
                cylinder("床脚", (x, y, 0.1), 0.045, 0.2, wood)
        box("实木床架", (0, 0, 0.23), (1.8, 2.06, 0.23), wood, 0.055)
        box("软包床头", (0, 0.98, 0.63), (1.8, 0.14, 0.94), accent, 0.07)
        for x in [-0.58, 0, 0.58]:
            box("床头分缝", (x, 0.90, 0.66), (0.006, 0.004, 0.73), fabric, 0.001)
        box("床垫", (0, -0.02, 0.42), (1.74, 1.97, 0.22), fabric, 0.08)
        seam("床垫包边", 0, -0.02, 0.50, 1.68, 1.91, fabric)
        box("蓬松被褥", (0, -0.28, 0.59), (1.78, 1.42, 0.16), fabric, 0.07)
        box("被褥翻边", (0, 0.34, 0.68), (1.72, 0.20, 0.035), fabric, 0.015)
        for x in [-0.43, 0.43]:
            box("双层枕", (x, 0.62, 0.59), (0.69, 0.4, 0.16), fabric, 0.095)
        box("床尾织毯", (0, -0.65, 0.69), (1.77, 0.41, 0.025), accent, 0.008)
        for x in np.linspace(-0.82, 0.82, 28):
            pipe("毯边流苏", [(x, -0.85, 0.69), (x, -0.94, 0.66)], 0.003, accent)
    elif kind in {"cabinet", "counter"}:
        w, d, h = SPECS[kind][1]
        box("内柜体", (0, 0, h / 2), (w, d, h), wood, 0.015)
        box("踢脚凹槽", (0, -0.29, 0.055), (w - 0.08, 0.03, 0.11), m["dark"], 0.004)
        count = 3 if kind == "counter" else 2
        for i in range(count):
            x = -w / 2 + (i + 0.5) * w / count
            box(
                "门板",
                (x, -0.307, h / 2 + 0.03),
                (w / count - 0.012, 0.028, h - 0.15),
                wood,
                0.006,
            )
            pipe(
                "拉丝长把手",
                [
                    (x + w / count * 0.32, -0.335, h * 0.48),
                    (x + w / count * 0.32, -0.335, h * 0.68),
                ],
                0.008,
                metal,
            )
        if kind == "cabinet":
            for z in [0.43, 1.04, 1.64]:
                box("侧板层线", (0.797, 0, z), (0.006, 0.57, 0.006), m["dark"], 0.001)
        else:
            box("石质台面", (0, 0, h), (w + 0.02, d + 0.04, 0.045), m["stone"], 0.012)
            for x in [-0.4, 0, 0.4]:
                box(
                    "抽屉分缝",
                    (x, -0.323, 0.73),
                    (0.37, 0.006, 0.008),
                    m["dark"],
                    0.001,
                )
    elif kind in {"table", "desk"}:
        w, d, h = SPECS[kind][1]
        box("圆角桌板", (0, 0, h - 0.045), (w, d, 0.09), wood, 0.04)
        box("桌底框", (0, 0, h - 0.12), (w - 0.2, d - 0.2, 0.075), wood, 0.02)
        for x in [-w * 0.39, w * 0.39]:
            for y in [-d * 0.32, d * 0.32]:
                pipe(
                    "斜向实木桌脚",
                    [(x * 1.08, y * 1.12, 0.025), (x, y, h - 0.08)],
                    0.033,
                    wood,
                )
        if kind == "desk":
            box("抽屉盒", (0.23, 0, 0.61), (0.6, 0.46, 0.17), wood, 0.018)
            box("抽屉面", (0.23, -0.27, 0.61), (0.6, 0.027, 0.17), wood, 0.008)
            pipe("抽屉拉手", [(0.11, -0.297, 0.61), (0.35, -0.297, 0.61)], 0.008, metal)
    elif kind == "chair":
        box("软包座椅", (0, -0.015, 0.46), (0.49, 0.47, 0.095), fabric, 0.045)
        seam("椅垫滚边", 0, -0.015, 0.485, 0.44, 0.42, fabric)
        for x in [-0.18, 0.18]:
            for y in [-0.18, 0.18]:
                pipe(
                    "实木椅腿", [(x * 1.17, y * 1.15, 0.02), (x, y, 0.44)], 0.022, wood
                )
            pipe("椅背支架", [(x, 0.18, 0.43), (x, 0.23, 0.79)], 0.022, wood)
        points = [
            (0.235 * math.cos(t), 0.1 + 0.15 * math.sin(t), 0.78)
            for t in np.linspace(0, math.pi, 24)
        ]
        pipe("弧形木靠背", points, 0.055, wood)
    elif kind == "rug":
        box("织物毯身", (0, 0, 0.014), (1.93, 1.44, 0.025), accent, 0.012)
        seam("地毯包边", 0, 0, 0.028, 1.87, 1.38, fabric)
        for y in [-0.73, 0.73]:
            for x in np.linspace(-0.92, 0.92, 64):
                pipe(
                    "地毯流苏",
                    [(x, y, 0.012), (x + 0.007, y * 1.06, 0.009)],
                    0.003,
                    fabric,
                )
    elif kind == "plant":
        vessel(
            "陶制花盆",
            [
                (0, 0.015),
                (0.14, 0.015),
                (0.19, 0.29),
                (0.18, 0.31),
                (0.16, 0.29),
                (0.12, 0.06),
                (0, 0.06),
            ],
            m["white"],
        )
        cylinder("盆土", (0, 0, 0.265), 0.166, 0.02, m["soil"])
        pipe(
            "主干", [(0, 0, 0.22), (0.02, -0.01, 0.6), (-0.02, 0.02, 1.18)], 0.016, wood
        )
        for i in range(24):
            a, z = i * 2.4, 0.52 + i * 0.028
            r = 0.24 * (1 - (i / 33) ** 2)
            end = (r * math.cos(a), r * math.sin(a), z + 0.13)
            pipe("分枝", [(0, 0, z - 0.05), end], 0.004, wood)
            for j in range(3):
                leaf = sphere(
                    "橄榄叶",
                    (
                        end[0] * (0.7 + 0.15 * j),
                        end[1] * (0.7 + 0.15 * j),
                        end[2] + 0.025 * j,
                    ),
                    (0.045, 0.10, 0.012),
                    m["leaf"],
                )
                leaf.rotation_euler = (0.3, 0.45, a + j * 0.5)
    elif kind == "sink":
        box("浴室柜", (0, 0, 0.37), (0.8, 0.48, 0.69), wood, 0.015)
        for x in [-0.2, 0.2]:
            box("浴室柜门", (x, -0.247, 0.38), (0.388, 0.023, 0.61), wood, 0.006)
            pipe(
                "浴室柜把手",
                [(x - 0.06, -0.27, 0.58), (x + 0.06, -0.27, 0.58)],
                0.006,
                metal,
            )
        box("石质台板", (0, 0, 0.73), (0.8, 0.5, 0.045), m["stone"], 0.012)
        bowl = vessel(
            "内凹陶瓷盆",
            [
                (0, 0),
                (0.18, 0),
                (0.24, 0.1),
                (0.23, 0.14),
                (0.21, 0.13),
                (0.15, 0.025),
                (0, 0.025),
            ],
            m["white"],
            1.15,
            0.76,
        )
        bowl.location.z = 0.75
        pipe(
            "鹅颈龙头",
            [
                (0, 0.2, 0.76),
                (0, 0.2, 0.94),
                (0, 0.16, 0.98),
                (0, 0.06, 0.98),
                (0, 0.05, 0.94),
            ],
            0.011,
            metal,
        )
    elif kind == "bathtub":
        vessel(
            "浴缸整体内外壳",
            [
                (0, 0.035),
                (0.31, 0.035),
                (0.46, 0.12),
                (0.50, 0.51),
                (0.485, 0.59),
                (0.445, 0.60),
                (0.42, 0.54),
                (0.34, 0.17),
                (0, 0.14),
            ],
            m["white"],
            0.78,
            1.65,
        )
        cylinder("浴缸排水口", (0, -0.15, 0.148), 0.022, 0.005, metal)
    elif kind == "toilet":
        sphere("陶瓷底座", (0, 0, 0.22), (0.16, 0.24, 0.22), m["white"])
        box("圆角水箱", (0, 0.23, 0.54), (0.36, 0.19, 0.43), m["white"], 0.065)
        bowl = vessel(
            "坐便器盆体",
            [
                (0, 0),
                (0.13, 0),
                (0.22, 0.2),
                (0.215, 0.23),
                (0.18, 0.235),
                (0.14, 0.12),
                (0, 0.09),
            ],
            m["white"],
            0.90,
            1.25,
        )
        bowl.location = (0, -0.05, 0.2)
        sphere("闭合坐便盖", (0, -0.065, 0.452), (0.198, 0.275, 0.025), m["white"])
        box("双档冲水键", (0, 0.23, 0.761), (0.095, 0.042, 0.008), metal, 0.005)


def bake_asset(kind, mats):
    bpy.ops.object.select_all(action="DESELECT")
    before = set(bpy.data.objects)
    construct(kind, mats)
    parts = list(set(bpy.data.objects) - before)
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    obj = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    low = Vector(tuple(min(v.co[i] for v in obj.data.vertices) for i in range(3)))
    high = Vector(tuple(max(v.co[i] for v in obj.data.vertices) for i in range(3)))
    size = high - low
    target = SPECS[kind][1]
    translate = Matrix.Translation(
        Vector((-(low.x + high.x) / 2, -(low.y + high.y) / 2, -low.z))
    )
    obj.data.transform(
        Matrix.Diagonal(Vector((*[target[i] / size[i] for i in range(3)], 1)))
        @ translate
    )
    # 为曲线转网格和旋转体补齐可导出的 UV。
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.name = "家具_" + kind
    obj["asset_id"] = "habitat_" + kind
    collection = bpy.data.collections.new("asset_" + kind)
    bpy.context.scene.collection.children.link(collection)
    for previous in list(obj.users_collection):
        previous.objects.unlink(obj)
    collection.objects.link(obj)
    collection.asset_mark()
    collection.asset_data.description = SPECS[kind][0]
    collection.asset_data.author = "造个家项目"
    return obj


def main():
    LIBRARY.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    textures()
    mats = palette_materials("natural")
    entries = []
    for i, kind in enumerate(SPECS):
        obj = bake_asset(kind, mats)
        obj.location = ((i % 4) * 3.2, (i // 4) * 3.2, 0)
        obj.data.calc_loop_triangles()
        entries.append(
            {
                "id": "habitat_" + kind,
                "kind": kind,
                "name": SPECS[kind][0],
                "collection": "asset_" + kind,
                "dimensions": SPECS[kind][1],
                "triangles": len(obj.data.loop_triangles),
            }
        )
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.ops.file.pack_all()
    path = LIBRARY / "habitat-furniture.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    catalog = {
        "version": VERSION,
        "blender_version": bpy.app.version_string,
        "library": path.name,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "license": "本项目原创几何与程序纹理，可随项目使用和修改；无第三方模型依赖。",
        "items": entries,
    }
    (LIBRARY / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("ASSET_LIBRARY_COMPLETE", len(entries))


if __name__ == "__main__":
    main()
