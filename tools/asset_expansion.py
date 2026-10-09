"""家具库 2.0：原创家具和家电，Blender 坐标 Z 向上、正面朝 -Y。"""

import math

import bpy

from asset_geometry import box, cylinder, sphere
from asset_materials import material
from asset_bathroom import shower

SPECS = {
    "television": ("55 英寸落地支架电视", (1.24, 0.42, 1.36)),
    "wall_television": ("55 英寸超薄壁挂电视", (1.24, 0.1, 0.71)),
    "tv_console": ("悬浮感格栅电视柜", (1.8, 0.4, 0.52)),
    "coffee_table": ("双层圆角茶几", (1.1, 0.62, 0.42)),
    "side_table": ("圆盘实木边几", (0.45, 0.45, 0.55)),
    "nightstand": ("双抽床头柜", (0.48, 0.4, 0.52)),
    "bookshelf": ("开放分格书柜", (0.9, 0.32, 1.85)),
    "shoe_cabinet": ("玄关百叶鞋柜", (1.0, 0.35, 1.05)),
    "washing_machine": ("滚筒洗烘一体机", (0.6, 0.62, 0.85)),
    "dishwasher": ("独立式洗碗机", (0.6, 0.6, 0.85)),
    "oven": ("台柜式嵌入烤箱", (0.6, 0.6, 0.85)),
    "armchair": ("木扶手休闲单椅", (0.78, 0.8, 0.86)),
    "bench": ("软包储物换鞋凳", (0.9, 0.36, 0.46)),
    "shower": ("极简黑框玻璃淋浴房", (1.0, 1.0, 2.1)),
    "shower_walk_in": ("单屏步入式淋浴区", (1.0, 1.0, 2.1)),
    "shower_open": ("开放式淋浴花洒", (1.0, 1.0, 2.1)),
    "refrigerator": ("银灰双门冰箱", (0.65, 0.65, 1.8)),
}


def materials(m):
    m = dict(m)
    for key, color, roughness, metallic in [
        ("steel", (0.42, 0.46, 0.48), 0.28, 0.82),
        ("screen", (0.014, 0.028, 0.037), 0.16, 0.22),
        ("rubber", (0.025, 0.028, 0.031), 0.88, 0),
        ("indicator", (0.20, 0.56, 0.63), 0.3, 0.1),
        ("book_red", (0.36, 0.12, 0.09), 0.85, 0),
        ("book_blue", (0.09, 0.19, 0.25), 0.85, 0),
    ]:
        m[key] = material(f"专用_{key}", color, roughness, metallic)
        m[key]["surface_category"] = "fixed"
    glass = material("专用_淋浴透明玻璃", (0.66, 0.84, 0.87), 0.09)
    bsdf = glass.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Alpha"].default_value = 0.2
    bsdf.inputs["Transmission Weight"].default_value = 0.25
    bsdf.inputs["IOR"].default_value = 1.45
    glass.diffuse_color = (0.66, 0.84, 0.87, 0.2)
    glass.surface_render_method = "DITHERED"
    m["clear"] = glass
    return m


def feet(w, d, height, m, radius=0.022):
    for x in [-w * 0.4, w * 0.4]:
        for y in [-d * 0.34, d * 0.34]:
            cylinder("支脚", (x, y, height / 2), radius, height, m)


def front_disc(name, x, y, z, radius, depth, m):
    obj = cylinder(name, (x, y, z), radius, depth, m)
    obj.rotation_euler.x = math.pi / 2
    return obj


def ring(name, x, y, z, radius, tube, mat):
    bpy.ops.mesh.primitive_torus_add(major_segments=48, minor_segments=8,
        location=(x, y, z), major_radius=radius, minor_radius=tube,
        rotation=(math.pi / 2, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    for face in obj.data.polygons:
        face.use_smooth = True


def construct(kind, m, pipe, seam):
    if kind not in SPECS:
        return False
    w, d, h = SPECS[kind][1]
    wood, fabric, steel, dark = m["wood"], m["fabric"], m["steel"], m["rubber"]
    if kind == "wall_television":
        box("壁面固定挂架", (0, .036, h / 2), (.42, .028, .23), steel, .005)
        box("超薄一体电视机身", (0, -.008, h / 2), (w, .042, h), dark, .009)
        box("窄边黑晶屏幕", (0, -.031, h / 2 + .002), (w - .018, .003, h - .022), m["screen"], .001)
        box("下沿金属饰条", (0, -.033, .008), (w - .02, .004, .007), steel, .001)
        sphere("待机指示灯", (.48, -.036, .008), (.002, .001, .002), m["indicator"])
    elif kind == "television":
        box("加重圆角底座", (0, 0, 0.025), (0.65, d, 0.05), dark, 0.025)
        box("支架立柱", (0, 0.06, 0.40), (0.07, 0.065, 0.76), steel, 0.015)
        box("机背安装座", (0, 0.035, 0.95), (0.27, 0.08, 0.23), dark, 0.018)
        box("超薄电视机身", (0, -0.025, 1.005), (w, 0.047, 0.71), dark, 0.013)
        box("一体黑晶屏幕", (0, -0.051, 1.009), (w - 0.022, 0.003, 0.683), m["screen"], 0.001)
        box("底部金属饰条", (0, -0.052, 0.658), (w - 0.026, 0.006, 0.008), steel, 0.002)
        sphere("待机指示灯", (0.47, -0.057, 0.658), (0.0025, 0.002, 0.0025), m["indicator"])
        for x in [-0.3, -0.27, -0.24, 0.24, 0.27, 0.3]:
            box("机背散热槽", (x, 0.001, 1.05), (0.007, 0.002, 0.18), m["screen"], 0)
    elif kind in {"tv_console", "nightstand", "shoe_cabinet"}:
        lift = 0.10 if kind != "shoe_cabinet" else 0.12
        feet(w, d, lift, wood)
        box("柜体", (0, 0, (h - 0.028 + lift) / 2), (w, d - 0.025, h - 0.028 - lift), wood, 0.016)
        box("独立顶板", (0, -0.005, h - 0.014), (w + 0.012, d + 0.006, 0.028), m["stone"] if kind == "nightstand" else wood, 0.009)
        if kind == "nightstand":
            for z in [0.22, 0.40]:
                box("抽屉面板", (0, -d / 2, z), (w - 0.025, 0.028, 0.161), wood, 0.008)
                pipe("抽屉圆角拉手", [(-0.07, -d / 2 - 0.022, z + 0.035), (0.07, -d / 2 - 0.022, z + 0.035)], 0.006, m["metal"])
        else:
            count = 3 if kind == "tv_console" else 2
            for i in range(count):
                x = -w / 2 + (i + 0.5) * w / count
                box("门缝阴影", (x, -d / 2, (h + lift) / 2), (w / count - 0.008, 0.016, h - lift - 0.03), dark, 0.004)
                if kind == "tv_console":
                    for j in range(14):
                        xx = x - w / count / 2 + 0.023 + j * (w / count - 0.046) / 13
                        box("竖向木格栅", (xx, -d / 2 - 0.012, (h + lift) / 2), (0.025, 0.026, h - lift - 0.06), wood, 0.006)
                else:
                    for j in range(12):
                        z = lift + 0.065 + j * (h - lift - 0.13) / 11
                        slat = box("鞋柜通风百叶", (x, -d / 2 - 0.012, z), (w / count - 0.04, 0.024, 0.04), wood, 0.005)
                        slat.rotation_euler.x = -0.25
                pipe("门把手", [(x + w / count * 0.34, -d / 2 - 0.04, h * 0.53), (x + w / count * 0.34, -d / 2 - 0.04, h * 0.66)], 0.006, m["metal"])
    elif kind in {"coffee_table", "side_table"}:
        if kind == "side_table":
            cylinder("圆盘台面", (0, 0, h - 0.024), w / 2, 0.048, wood)
            cylinder("托盘内面", (0, 0, h + 0.002), w / 2 - 0.012, 0.004, m["stone"])
            for a in [0, 2.094, 4.189]:
                pipe("三向斜脚", [(0.18 * math.cos(a), 0.18 * math.sin(a), 0.022), (0.09 * math.cos(a), 0.09 * math.sin(a), h - 0.046)], 0.022, wood)
        else:
            box("圆角石面", (0, 0, h - 0.025), (w, d, 0.05), m["stone"], 0.06)
            box("实木下层板", (0, 0, 0.12), (w - 0.10, d - 0.08, 0.025), wood, 0.025)
            feet(w, d, h - 0.05, wood, 0.025)
    elif kind == "bookshelf":
        box("后背板", (0, d / 2 - 0.012, h / 2), (w, 0.024, h), wood, 0.004)
        for x in [-w / 2 + 0.016, w / 2 - 0.016]:
            box("侧板", (x, 0, h / 2), (0.032, d, h), wood, 0.006)
        for z in [0.06, 0.42, 0.78, 1.14, 1.5, h - 0.018]:
            box("层板", (0, 0, z), (w, d, 0.03), wood, 0.006)
        for row, z in enumerate([0.44, 0.80, 1.16, 1.52]):
            divider_x = -0.08 if row % 2 else 0.11
            box("错位竖隔板", (divider_x, 0, z + 0.16), (0.025, d, 0.33), wood, 0.004)
            for i in range(4):
                x = (-0.33 if row % 2 == 0 else 0.15) + i * 0.045
                height = 0.21 + (i % 3) * 0.025
                box("书册封面", (x, -0.012, z + height / 2), (0.033, 0.22, height), [m["book_blue"], m["book_red"], m["white"]][i % 3], 0.002)
                box("书脊标签", (x, -0.124, z + height * 0.72), (0.024, 0.002, 0.018), fabric, 0)
    elif kind in {"washing_machine", "dishwasher", "oven", "refrigerator"}:
        feet(w, d, 0.035, dark, 0.018)
        box("圆角金属机身", (0, 0.01, (h + 0.007) / 2), (w, d - 0.045, h - 0.063), steel if kind == "refrigerator" else m["white"], 0.025)
        box("上盖", (0, 0, h - 0.014), (w, d - 0.008, 0.028), steel, 0.012)
        front = -d / 2
        if kind == "refrigerator":
            for low, high in [(0.065, 0.65), (0.664, h - 0.045)]:
                box("独立箱门", (0, front + 0.013, (low + high) / 2), (w - 0.018, 0.035, high - low), steel, 0.018)
                pipe("直线拉手", [(-w * 0.36, front - 0.032, high - 0.27), (-w * 0.36, front - 0.032, high - 0.09)], 0.009, m["metal"])
            box("温控黑玻璃面板", (0.17, front - 0.007, 1.34), (0.095, 0.004, 0.17), m["screen"], 0.002)
            box("温度指示条", (0.17, front - 0.01, 1.37), (0.035, 0.002, 0.004), m["indicator"], 0)
        else:
            box("操作面板", (0, front, h - 0.095), (w - 0.027, 0.018, 0.12), steel, 0.005)
            front_disc("程序旋钮", -0.07, front - 0.017, h - 0.095, 0.026, 0.016, dark)
            box("控制屏", (0.13, front - 0.011, h - 0.095), (0.135, 0.004, 0.05), m["screen"], 0.003)
            for i in range(3):
                box("屏幕状态条", (0.095 + i * 0.035, front - 0.014, h - 0.094), (0.02, 0.002, 0.006), m["indicator"], 0)
            if kind == "washing_machine":
                box("前面板", (0, front + 0.016, 0.36), (w - 0.025, 0.024, 0.56), m["white"], 0.012)
                front_disc("滚筒深色内腔", 0, front - 0.009, 0.39, 0.202, 0.02, dark)
                front_disc("滚筒观察玻璃", 0, front - 0.022, 0.39, 0.165, 0.012, m["screen"])
                ring("滚筒金属门圈", 0, front - 0.034, 0.39, 0.193, 0.018, steel)
                ring("玻璃门密封圈", 0, front - 0.035, 0.39, 0.170, 0.008, dark)
                box("洗涤剂抽屉", (-0.20, front - 0.003, h - 0.096), (0.16, 0.012, 0.089), m["white"], 0.003)
                box("舱门把手", (0.183, front - 0.052, 0.39), (0.025, 0.025, 0.09), dark, 0.008)
                front_disc("检修盖", 0.20, front - 0.003, 0.12, 0.044, 0.004, m["white"])
            else:
                box("机门", (0, front + 0.01, 0.365), (w - 0.025, 0.034, 0.54), steel if kind == "dishwasher" else dark, 0.01)
                pipe("水平门把手", [(-0.19, front - 0.027, 0.64), (0.19, front - 0.027, 0.64)], 0.012, steel)
                if kind == "oven":
                    box("烤箱观察窗", (0, front - 0.010, 0.37), (0.43, 0.004, 0.32), m["screen"], 0.003)
                    for z in [0.29, 0.39, 0.49]:
                        box("烤架投影", (0, front - 0.014, z), (0.35, 0.002, 0.003), steel, 0)
        box("底部通风踢脚", (0, front, 0.045), (w - 0.025, 0.022, 0.045), dark, 0.003)
        for x in [-0.2, -0.16, -0.12, -0.08, -0.04, 0, 0.04, 0.08, 0.12, 0.16, 0.2]:
            box("散热栅格", (x, front - 0.015, 0.045), (0.004, 0.005, 0.027), steel, 0)
    elif kind == "armchair":
        feet(w, d, 0.26, wood, 0.031)
        box("实木底框", (0, 0, 0.27), (0.70, 0.71, 0.095), wood, 0.025)
        box("厚实坐垫", (0, -0.04, 0.41), (0.62, 0.63, 0.19), fabric, 0.07)
        back = box("倾斜软包靠背", (0, 0.27, 0.64), (0.62, 0.18, 0.46), fabric, 0.07)
        back.rotation_euler.x = -0.14
        for x in [-0.35, 0.35]:
            pipe("木扶手支架", [(x, -0.28, 0.25), (x, -0.28, 0.61), (x, 0.30, 0.61), (x, 0.30, 0.25)], 0.025, wood)
            box("圆角扶手", (x, -0.02, 0.635), (0.075, 0.7, 0.065), wood, 0.024)
        seam("座垫滚边", 0, -0.04, 0.48, 0.56, 0.56, fabric)
    elif kind == "bench":
        feet(w, d, 0.36, wood, 0.026)
        box("鞋架层板", (0, 0, 0.14), (w - 0.13, d - 0.06, 0.025), wood, 0.006)
        box("承重底框", (0, 0, 0.35), (w, d, 0.055), wood, 0.017)
        box("长条软垫", (0, 0, 0.415), (w - 0.02, d - 0.01, 0.09), fabric, 0.028)
        seam("软垫包边", 0, 0, 0.445, w - 0.07, d - 0.05, fabric)
    elif kind in {"shower", "shower_walk_in", "shower_open"}:
        shower(m, pipe, {"shower": "enclosed", "shower_walk_in": "walk_in", "shower_open": "open"}[kind])
    return True
