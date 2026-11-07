"""常用家电与卫浴补充：独立造型、米制尺寸和明确安装方式。"""

import math

import trimesh

from tools.chair_mesh import loft, rounded_ring

SPECS = [
    (
        "aircon_wall",
        "壁挂分体空调",
        "model",
        "卧室",
        "空调",
        "壁挂分体",
        (0.86, 0.22, 0.30),
        "aircon",
        "white",
    ),
    (
        "aircon_tower",
        "圆柱立式空调",
        "model",
        "客厅",
        "空调",
        "立式圆柱",
        (0.40, 0.40, 1.78),
        "tower",
        "white",
    ),
    (
        "kitchen_wall_cabinet",
        "双门厨房吊柜",
        "cabinet",
        "厨房",
        "厨房吊柜",
        "双门吊柜",
        (0.90, 0.34, 0.68),
        "wall_cabinet",
        "paint",
    ),
    (
        "range_hood",
        "超薄 T 型顶吸油烟机",
        "model",
        "厨房",
        "抽油烟机",
        "烟灰机身 · 触控面板",
        (0.90, 0.48, 0.55),
        "hood",
        "steel",
    ),
    (
        "microwave",
        "台式微波炉",
        "model",
        "厨房",
        "微波炉",
        "台式 · 双旋钮",
        (0.49, 0.38, 0.29),
        "microwave",
        "white",
    ),
    (
        "kitchen_cart",
        "双层厨房推车",
        "model",
        "厨房",
        "厨房推车",
        "双层窄推车",
        (0.60, 0.38, 0.85),
        "cart",
        "oak",
    ),
    (
        "bathroom_mirror_cabinet",
        "双门浴室镜柜",
        "cabinet",
        "卫浴",
        "镜柜",
        "壁挂镜柜",
        (0.80, 0.16, 0.70),
        "mirror_cabinet",
        "paint",
    ),
    (
        "towel_rail",
        "双杆毛巾架",
        "model",
        "卫浴",
        "毛巾架",
        "双杆壁挂",
        (0.60, 0.12, 0.16),
        "rail",
        "steel",
    ),
    (
        "laundry_basket",
        "布艺脏衣篮",
        "model",
        "卫浴",
        "脏衣篮",
        "原木底座 · 双提带",
        (0.42, 0.34, 0.56),
        "basket",
        "linen",
    ),
    (
        "waste_bin",
        "脚踏垃圾桶",
        "model",
        "厨房",
        "垃圾桶",
        "带盖脚踏",
        (0.28, 0.28, 0.40),
        "bin",
        "steel",
    ),
]

PLACEMENT = {
    "wall_television": ("wall", 1.05),
    "aircon_wall": ("wall", 2.1),
    "kitchen_wall_cabinet": ("wall", 1.5),
    "range_hood": ("wall", 1.5),
    "bathroom_mirror_cabinet": ("wall", 1.25),
    "towel_rail": ("wall", 1.1),
    "microwave": ("countertop", 0.85),
    "desktop_computer": ("countertop", 0.75),
    "laptop": ("countertop", 0.75),
}


def laundry_basket(m, w, d, h):
    bottom = 0.086
    rim = h - 0.043
    m.plate(
        "圆角原木底座",
        [0, bottom - 0.009, 0],
        [w * 0.83, 0.029, d * 0.83],
        "oak",
        0.065,
    )
    for x in [-w * 0.30, w * 0.30]:
        for z in [-d * 0.29, d * 0.29]:
            m.box("原木短脚", [x, 0.033, z], [0.034, 0.066, 0.034], "oak", 0.006)

    # 从篮底绕过翻边再回到内底。封住两端的底面，篮口保持敞开。
    profile = [
        (bottom, 0.79, 0.78, 0.060),
        (bottom + 0.012, 0.85, 0.84, 0.065),
        (bottom + 0.033, 0.89, 0.88, 0.069),
        (h * 0.48, 0.93, 0.92, 0.075),
        (rim - 0.040, 0.97, 0.97, 0.081),
        (rim - 0.035, 1.00, 1.00, 0.084),
        (rim - 0.007, 1.00, 1.00, 0.084),
        (rim, 0.975, 0.975, 0.081),
        (rim - 0.003, 0.938, 0.938, 0.076),
        (rim - 0.014, 0.928, 0.928, 0.074),
        (rim - 0.040, 0.935, 0.932, 0.075),
        (h * 0.48, 0.898, 0.881, 0.068),
        (bottom + 0.036, 0.856, 0.838, 0.062),
        (bottom + 0.016, 0.789, 0.776, 0.054),
    ]
    rings = [
        [(x, y, z) for x, z in rounded_ring(w * width, d * depth, radius)]
        for y, width, depth, radius in profile
    ]
    shell = loft("翻边帆布篮身", "cream", rings)
    m.add(
        shell["name"], trimesh.Trimesh(shell["vertices"], shell["faces"]), shell["role"]
    )

    # 织带从两端插入翻边下方，拱起后留出手指可穿过的空间。
    handle_base = rim - 0.046
    for side in [-1, 1]:
        rings = []
        for step in range(25):
            angle = math.pi * step / 24
            rise, depth = math.sin(angle), math.cos(angle)
            rings.append(
                [
                    (
                        side * (w * 0.464 + 0.015 * rise + across),
                        handle_base + (h - handle_base - 0.003 + outward) * rise,
                        (d * 0.178 + outward) * depth,
                    )
                    for across, outward in rounded_ring(0.023, 0.006, 0.002, steps=3)
                ]
            )
        handle = loft("鼠尾草绿织带提手", "sage", rings)
        m.add(
            handle["name"],
            trimesh.Trimesh(handle["vertices"], handle["faces"]),
            handle["role"],
        )


def range_hood(m, w, d, h):
    # 截面从罩顶回绕到凹入的进风腔；罩底中央留空，滤网位于腔内。
    profile = [
        (0.087, w - 0.040, d - 0.033, 0.021),
        (0.076, w, d - 0.006, 0.023),
        (0.032, w, d - 0.006, 0.023),
        (0.017, w - 0.058, d - 0.042, 0.020),
        (0.017, w - 0.126, d - 0.112, 0.016),
        (0.051, w - 0.180, d - 0.157, 0.016),
    ]
    rings = [
        [(x, y, z) for x, z in rounded_ring(width, depth, radius)]
        for y, width, depth, radius in profile
    ]
    canopy = loft("薄边集烟罩与内凹烟腔", "charcoal", rings)
    m.add(
        canopy["name"],
        trimesh.Trimesh(canopy["vertices"], canopy["faces"]),
        canopy["role"],
    )

    back = -d / 2 + 0.006
    m.box(
        "烟道外罩", [0, 0.217, back + 0.117], [0.294, 0.274, 0.234], "charcoal", 0.007
    )
    m.box(
        "内收烟道上罩",
        [0, (h + 0.348) / 2, back + 0.108],
        [0.279, h - 0.348, 0.216],
        "charcoal",
        0.006,
    )

    front = d / 2 - 0.003
    m.box("缎面前缘", [0, 0.056, front], [w - 0.038, 0.038, 0.009], "aluminum", 0.004)
    m.box(
        "黑晶触控面板",
        [0, 0.056, front + 0.005],
        [w - 0.055, 0.029, 0.006],
        "dark",
        0.004,
    )
    for x in [-0.061, -0.037, 0.037, 0.061]:
        m.rod(
            "触控键标记",
            [x, 0.056, front + 0.007],
            [x, 0.056, front + 0.009],
            0.0028,
            "white",
        )
    m.box("状态指示", [0, 0.056, front + 0.008], [0.024, 0.004, 0.002], "cream", 0.001)

    for x in [-w * 0.195, w * 0.195]:
        m.box("进风滤盒", [x, 0.046, 0.008], [w * 0.34, 0.014, d * 0.55], "dark", 0.006)
        for slot in range(-5, 6):
            m.box(
                "滤网金属窄条",
                [x + slot * 0.024, 0.038, 0.008],
                [0.007, 0.004, d * 0.49],
                "steel",
                0,
            )
        m.box("底部灯带", [x, 0.025, d * 0.377], [0.143, 0.009, 0.020], "cream", 0.003)
    m.box("后侧集油槽", [0, 0.020, -d * 0.36], [w * 0.70, 0.024, 0.039], "dark", 0.006)


def household(m, spec):
    key, _, _, _, _, _, (w, d, h), shape, role = spec
    if key not in {s[0] for s in SPECS}:
        return False
    if shape == "aircon":
        m.box("弧边机身", [0, h / 2, 0], [w, h, d], "white", 0.045)
        m.box(
            "出风暗槽",
            [0, 0.055, d / 2 - 0.008],
            [w - 0.10, 0.045, 0.025],
            "dark",
            0.012,
        )
        for yy in [0.042, 0.063]:
            m.box(
                "导风叶片",
                [0, yy, d / 2 + 0.004],
                [w - 0.12, 0.008, 0.025],
                "white",
                0.003,
            )
        m.box(
            "状态屏", [w * 0.28, h * 0.54, d / 2], [0.07, 0.022, 0.003], "screen", 0.004
        )
    elif shape == "tower":
        m.disk("柱形机身", [0, h / 2, 0], w / 2 - 0.01, h - 0.035, "white")
        m.disk("底座", [0, 0.02, 0], w / 2, 0.04, "charcoal")
        m.box(
            "纵向出风口",
            [0, h * 0.57, d * 0.45],
            [w * 0.44, h * 0.66, 0.04],
            "dark",
            0.04,
        )
        for i in range(15):
            m.box(
                "导风百叶",
                [0, h * 0.27 + i * 0.072, d * 0.49],
                [w * 0.38, 0.012, 0.016],
                "charcoal",
                0.005,
            )
        m.disk("顶部饰盖", [0, h - 0.018, 0], w / 2 - 0.02, 0.025, "charcoal")
    elif shape == "wall_cabinet":
        m.box("柜体", [0, h / 2, 0], [w, h, d - 0.018], role, 0.008)
        for x in [-w / 4, w / 4]:
            m.box(
                "分体柜门",
                [x, h / 2, d / 2],
                [w / 2 - 0.005, h - 0.008, 0.018],
                "paint",
                0.004,
            )
        for x in [-0.045, 0.045]:
            m.rod(
                "金属拉手",
                [x, 0.08, d / 2 + 0.028],
                [x, 0.21, d / 2 + 0.028],
                0.006,
                "steel",
            )
            for y in [0.092, 0.198]:
                m.rod(
                    "拉手固定脚",
                    [x, y, d / 2 + 0.004],
                    [x, y, d / 2 + 0.028],
                    0.005,
                    "steel",
                )
    elif shape == "mirror_cabinet":
        m.box(
            "浅色壁挂柜体",
            [0, h / 2, -0.007],
            [w - 0.009, h - 0.012, d - 0.014],
            "paint",
            0.009,
        )
        for x in [-w / 4, w / 4]:
            m.box(
                "圆角独立门板",
                [x, h / 2, d / 2 - 0.010],
                [w / 2 - 0.004, h, 0.021],
                "white",
                0.006,
            )
            m.box(
                "内嵌镜面",
                [x, h / 2 + 0.011, d / 2 + 0.002],
                [w / 2 - 0.027, h - 0.048, 0.005],
                "mirror",
                0.006,
            )
            m.box(
                "下沿指扣",
                [x, 0.017, d / 2 + 0.004],
                [0.085, 0.012, 0.015],
                "aluminum",
                0.004,
            )
    elif shape == "hood":
        range_hood(m, w, d, h)
    elif shape == "microwave":
        front = d / 2 - 0.022
        m.box(
            "圆角白色机壳",
            [0, (h + 0.009) / 2, -0.011],
            [w, h - 0.009, d - 0.022],
            "white",
            0.018,
        )
        m.box(
            "独立微波炉门",
            [-0.050, h / 2 + 0.005, front + 0.003],
            [w - 0.111, h - 0.033, 0.016],
            "paint",
            0.013,
        )
        m.box(
            "烟黑玻璃视窗",
            [-0.059, h / 2 + 0.006, front + 0.012],
            [w - 0.151, h - 0.078, 0.005],
            "dark",
            0.015,
        )
        m.box(
            "内收门把槽",
            [0.121, h / 2 + 0.004, front + 0.012],
            [0.009, h * 0.55, 0.003],
            "charcoal",
            0.003,
        )
        knob_x = w * 0.392
        for y, radius in [(h * 0.69, 0.026), (h * 0.37, 0.022)]:
            m.rod(
                "旋钮暗色座圈",
                [knob_x, y, front - 0.001],
                [knob_x, y, front + 0.006],
                radius + 0.004,
                "charcoal",
            )
            m.rod(
                "缎银机械旋钮",
                [knob_x, y, front + 0.005],
                [knob_x, y, front + 0.019],
                radius,
                "aluminum",
            )
            m.box(
                "旋钮指示刻度",
                [knob_x, y + radius * 0.52, front + 0.019],
                [0.003, 0.008, 0.0015],
                "dark",
                0.0005,
            )
        for y in [h * (0.50 + i * 0.047) for i in range(6)]:
            m.box(
                "侧后散热槽",
                [w / 2 - 0.0003, y, -d * 0.22],
                [0.002, 0.003, 0.070],
                "charcoal",
                0,
            )
        for x in [-w * 0.36, w * 0.36]:
            for z in [-d * 0.33, d * 0.28]:
                m.box(
                    "台面脚垫", [x, 0.007, z], [0.030, 0.014, 0.026], "charcoal", 0.003
                )
    elif shape == "cart":
        for y in [0.12, h - 0.055]:
            m.plate("木托盘", [0, y, 0], [w, 0.035, d], "oak", 0.025)
            for z in [-d / 2 + 0.01, d / 2 - 0.01]:
                m.box("挡沿", [0, y + 0.035, z], [w, 0.06, 0.018], "oak", 0.005)
        for x in [-w / 2 + 0.035, w / 2 - 0.035]:
            for z in [-d / 2 + 0.035, d / 2 - 0.035]:
                m.rod("金属立柱", [x, 0.05, z], [x, h - 0.04, z], 0.012, "charcoal")
                m.box("脚轮", [x, 0.035, z], [0.05, 0.07, 0.045], "dark", 0.02)
    elif shape == "rail":
        for x in [-w / 2 + 0.025, w / 2 - 0.025]:
            m.box("墙面固定座", [x, h / 2, -d / 2], [0.05, h, 0.015], "steel", 0.015)
            m.rod("支臂", [x, h / 2, -d / 2], [x, h / 2, d / 2], 0.012, "steel")
        for z, y in [(0, h * 0.8), (d / 2, h * 0.35)]:
            m.rod("挂杆", [-w / 2 + 0.015, y, z], [w / 2 - 0.015, y, z], 0.012, "steel")
    elif shape == "basket":
        laundry_basket(m, w, d, h)
    elif shape == "bin":
        m.disk(
            "哑光烤漆桶身", [0, (h + 0.003) / 2, 0], w / 2 - 0.006, h - 0.039, "paint"
        )
        m.disk("桶口闭合缝", [0, h - 0.024, 0], w / 2 - 0.006, 0.012, "dark")
        m.disk("缓降金属桶盖", [0, h - 0.012, 0], w / 2, 0.024, "aluminum")
        m.disk("防滑内收底圈", [0, 0.015, 0], w / 2 - 0.008, 0.030, "charcoal")
        m.box(
            "后置盖铰链",
            [0, h - 0.029, -d / 2 + 0.012],
            [0.055, 0.043, 0.031],
            "charcoal",
            0.008,
        )
        m.box(
            "脚踏连接座",
            [0, 0.022, d * 0.352],
            [0.074, 0.024, 0.041],
            "charcoal",
            0.006,
        )
        m.box(
            "缎银脚踏面",
            [0, 0.027, d * 0.427],
            [0.073, 0.013, 0.044],
            "aluminum",
            0.005,
        )
        for x in [-0.018, 0, 0.018]:
            m.box("脚踏防滑纹", [x, 0.034, d * 0.427], [0.002, 0.002, 0.024], "dark", 0)
    return True
