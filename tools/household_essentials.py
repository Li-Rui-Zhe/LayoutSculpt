"""常用家电与卫浴补充：独立造型、米制尺寸和明确安装方式。"""

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
        "薄型烟机",
        "model",
        "厨房",
        "抽油烟机",
        "顶吸烟机",
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
        "台式",
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
        "木框布篮",
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
    elif shape in {"wall_cabinet", "mirror_cabinet"}:
        m.box("柜体", [0, h / 2, 0], [w, h, d - 0.018], role, 0.008)
        for x in [-w / 4, w / 4]:
            m.box(
                "分体柜门",
                [x, h / 2, d / 2],
                [w / 2 - 0.005, h - 0.008, 0.018],
                "mirror" if shape == "mirror_cabinet" else "paint",
                0.004,
            )
        if shape == "wall_cabinet":
            for x in [-0.045, 0.045]:
                m.rod(
                    "金属拉手",
                    [x, 0.08, d / 2 + 0.028],
                    [x, 0.21, d / 2 + 0.028],
                    0.006,
                    "steel",
                )
    elif shape == "hood":
        m.box("集烟罩", [0, 0.055, 0], [w, 0.11, d], "steel", 0.018)
        m.box(
            "烟道", [0, h / 2 + 0.04, -d * 0.22], [0.27, h - 0.08, 0.24], "steel", 0.012
        )
        m.box("前面玻璃面板", [0, 0.06, d / 2], [w - 0.03, 0.055, 0.009], "dark", 0.005)
        for x in [-0.20, 0.20]:
            m.box("滤网", [x, 0.005, 0], [0.30, 0.008, 0.28], "charcoal", 0.008)
    elif shape == "microwave":
        m.box("圆角外壳", [0, h / 2, 0], [w, h, d], "white", 0.022)
        m.box(
            "玻璃门",
            [-0.035, h / 2, d / 2 + 0.004],
            [w - 0.11, h - 0.045, 0.012],
            "dark",
            0.015,
        )
        m.box(
            "内层视窗",
            [-0.05, h * 0.51, d / 2 + 0.012],
            [w - 0.19, h - 0.11, 0.004],
            "charcoal",
            0.012,
        )
        m.rod(
            "竖向门把手",
            [w * 0.26, 0.055, d / 2 + 0.04],
            [w * 0.26, h - 0.055, d / 2 + 0.04],
            0.009,
            "steel",
        )
        m.box(
            "操作显示",
            [w * 0.40, h * 0.70, d / 2 + 0.008],
            [0.045, 0.04, 0.005],
            "screen",
            0.003,
        )
        for y in [0.08, 0.12]:
            m.box(
                "按键",
                [w * 0.40, y, d / 2 + 0.01],
                [0.025, 0.012, 0.008],
                "charcoal",
                0.004,
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
        m.soft("布艺内袋", [0, h * 0.46, 0], [w - 0.045, h * 0.86, d - 0.045], "linen")
        for x in [-w / 2 + 0.02, w / 2 - 0.02]:
            for z in [-d / 2 + 0.02, d / 2 - 0.02]:
                m.rod("木框", [x, 0, z], [x, h, z], 0.017, "oak")
            m.rod("上提手", [x, h, -d / 2 + 0.02], [x, h, d / 2 - 0.02], 0.017, "oak")
        m.box(
            "内袋开口", [0, h * 0.90, 0], [w - 0.09, 0.015, d - 0.085], "charcoal", 0.03
        )
    elif shape == "bin":
        m.disk("桶身", [0, h * 0.49, 0], w / 2 - 0.008, h * 0.94, "steel")
        m.disk("独立桶盖", [0, h - 0.014, 0], w / 2, 0.028, "steel")
        m.disk("底圈", [0, 0.012, 0], w / 2, 0.024, "dark")
        m.box("脚踏板", [0, 0.035, d / 2], [0.10, 0.018, 0.08], "dark", 0.01)
    return True
