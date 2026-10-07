"""Dimension-aware furniture parts. Coordinates are X/right, Y/up, Z/front."""


def construct(builder, item):
    w, d, h, kind = item["width"], item["depth"], item["height"], item["kind"]
    name = item.get("name", "")
    box, cylinder = builder.box, builder.cylinder
    if kind == "cabinet" and h < 1.2:
        # Keep legs, door gaps and tops at human scale instead of squashing a wardrobe.
        feet = min(0.14, h * 0.22)
        for x in [-w * 0.4, w * 0.4]:
            for z in [-d * 0.35, d * 0.35]:
                cylinder("低柜细脚", [x, feet / 2, z], 0.018, feet, "metal")
        box("低柜柜体", [0, (h + feet) / 2, 0], [w, h - feet, d], "wood")
        count = max(1, round(w / 0.45))
        for i in range(count):
            x = -w / 2 + (i + 0.5) * w / count
            box(
                "低柜门板",
                [x, (h + feet) / 2, d / 2],
                [w / count - 0.012, h - feet - 0.04, 0.018],
                "wood",
            )
            box(
                "低柜拉手",
                [x, h - 0.07, d / 2 + 0.018],
                [min(0.14, w / count * 0.4), 0.008, 0.012],
                "metal",
            )
        box(
            "低柜台面",
            [0, h - 0.012, 0],
            [w + 0.008, 0.024, d + 0.015],
            "stone" if "床头" in name else "wood",
        )
        return True
    if kind == "table" and h < 0.6:
        box("茶几台面", [0, h - 0.025, 0], [w, 0.05, d], "stone")
        box("茶几底层", [0, 0.13, 0], [w * 0.85, 0.025, d * 0.8], "wood")
        for x in [-w * 0.37, w * 0.37]:
            for z in [-d * 0.32, d * 0.32]:
                cylinder("茶几桌脚", [x, (h - 0.05) / 2, z], 0.018, h - 0.05, "wood")
        return True
    if kind == "shower":
        box("淋浴底盘", [0, 0.045, 0], [w, 0.09, d], "white")
        box("淋浴地面", [0, 0.096, 0], [w - 0.08, 0.012, d - 0.08], "stone")
        box("淋浴排水", [0, 0.104, -d * 0.32], [w * 0.55, 0.006, 0.035], "metal")
        # Side and front screens leave a real walk-in entrance on the right.
        box("淋浴侧玻璃", [-w / 2 + 0.018, h / 2, 0], [0.012, h - 0.16, d], "glass")
        box(
            "淋浴前玻璃",
            [-w * 0.22, h / 2, d / 2 - 0.018],
            [w * 0.5, h - 0.16, 0.012],
            "glass",
        )
        for x, z in [(-w / 2, -d / 2), (-w / 2, d / 2), (w * 0.03, d / 2)]:
            cylinder("淋浴框", [x, h / 2, z], 0.014, h, "metal")
        cylinder(
            "花洒立杆", [w * 0.15, h * 0.55, -d / 2 + 0.08], 0.013, h * 0.72, "metal"
        )
        box(
            "花洒横臂",
            [w * 0.15, h * 0.9, -d * 0.25],
            [0.025, 0.025, d * 0.35],
            "metal",
        )
        cylinder(
            "顶喷花洒",
            [w * 0.15, h * 0.9 - 0.025, -d * 0.08],
            min(0.11, w * 0.15),
            0.025,
            "metal",
        )
        box(
            "恒温控制器",
            [w * 0.15, h * 0.48, -d / 2 + 0.09],
            [0.2, 0.035, 0.04],
            "metal",
        )
        return True
    if kind == "refrigerator":
        box("冰箱箱体", [0, h / 2, 0], [w, h, d - 0.035], "white")
        for bottom, top in [(0.05, h * 0.34), (h * 0.34 + 0.014, h - 0.025)]:
            box(
                "冰箱门",
                [0, (bottom + top) / 2, d / 2],
                [w - 0.014, top - bottom, 0.035],
                "white",
            )
            box(
                "冰箱把手",
                [-w * 0.36, top - 0.14, d / 2 + 0.035],
                [0.022, min(0.24, (top - bottom) * 0.6), 0.025],
                "metal",
            )
        box("冰箱踢脚", [0, 0.024, d / 2], [w - 0.05, 0.048, 0.025], "dark")
        return True
    return False


def kitchen_details(builder, item):
    w, d, h = item["width"], item["depth"], item["height"]
    name = item.get("name", "")
    if item["kind"] != "counter":
        return
    if any(word in name for word in ["水槽", "洗菜", "洗涤"]):
        sw, sd = min(0.65, w * 0.75), d * 0.65
        builder.box("水槽嵌边", [0, h + 0.017, 0], [sw, 0.025, sd], "metal")
        builder.box(
            "水槽内腔", [0, h + 0.031, 0], [sw - 0.045, 0.003, sd - 0.045], "dark"
        )
        builder.cylinder(
            "水龙头立杆", [0, h + 0.15, -sd / 2 - 0.02], 0.016, 0.27, "metal"
        )
        builder.box(
            "水龙头出水臂", [0, h + 0.28, -sd / 4], [0.025, 0.025, sd / 2], "metal"
        )
    elif any(word in name for word in ["灶", "烹饪"]):
        sw = min(0.68, w * 0.8)
        builder.box("嵌入式灶台", [0, h + 0.024, 0], [sw, 0.02, d * 0.7], "dark")
        for x in [-sw * 0.25, sw * 0.25]:
            builder.cylinder(
                "灶台炉圈", [x, h + 0.04, 0], min(0.10, sw * 0.16), 0.012, "metal"
            )
            builder.cylinder(
                "炉芯", [x, h + 0.049, 0], min(0.068, sw * 0.1), 0.012, "dark"
            )


def construct_basic(builder, item):
    """Low-poly layout preview still communicates a bed, sofa or chair's orientation."""
    w, d, h, kind = item["width"], item["depth"], item["height"], item["kind"]
    b, c = builder.box, builder.cylinder
    if kind == "bed":
        b("床架", [0, h * 0.2, 0], [w, h * 0.3, d], "wood")
        b("床垫", [0, h * 0.45, 0], [w * 0.96, h * 0.22, d * 0.92], "fabric")
        b("床头", [0, h / 2, -d * 0.46], [w, h, 0.08], "accent")
        for x in [-w * 0.24, w * 0.24]:
            b("枕头", [x, h * 0.62, -d * 0.3], [w * 0.4, h * 0.12, d * 0.19], "fabric")
    elif kind == "sofa":
        b("沙发座", [0, h * 0.35, 0], [w, h * 0.4, d], "fabric")
        b("沙发背", [0, h * 0.66, -d * 0.4], [w, h * 0.68, d * 0.2], "fabric")
        for x in [-w * 0.46, w * 0.46]:
            b("沙发扶手", [x, h * 0.48, 0], [w * 0.08, h * 0.6, d], "accent")
    elif kind in {"table", "desk", "chair"}:
        level = h * 0.55 if kind == "chair" else h - 0.04
        b(
            "座面" if kind == "chair" else "桌面",
            [0, level, 0],
            [w, 0.055, d],
            "fabric" if kind == "chair" else "wood",
        )
        for x in [-w * 0.39, w * 0.39]:
            for z in [-d * 0.35, d * 0.35]:
                c("支脚", [x, level / 2, z], 0.025, level, "wood")
        if kind == "chair":
            b("椅背", [0, h * 0.78, -d * 0.44], [w, h * 0.4, 0.04], "wood")
    elif kind == "plant":
        c("花盆", [0, h * 0.15, 0], min(w, d) * 0.3, h * 0.3, "white")
        c("树干", [0, h * 0.5, 0], 0.025, h * 0.65, "wood")
        builder.sphere("树冠", [0, h * 0.7, 0], [w / 2, h * 0.3, d / 2], "leaf")
    elif kind in {"sink", "toilet", "bathtub"}:
        b("卫浴底座", [0, h * 0.35, 0], [w * 0.85, h * 0.7, d * 0.9], "white")
        b("陶瓷面", [0, h * 0.76, 0], [w, h * 0.15, d], "white")
        b("盆内面", [0, h * 0.84, 0], [w * 0.66, 0.01, d * 0.64], "stone")
        if kind == "toilet":
            b("水箱", [0, h * 0.65, -d * 0.36], [w * 0.85, h * 0.7, d * 0.22], "white")
    else:
        b(
            "地毯" if kind == "rug" else "柜体",
            [0, h / 2, 0],
            [w, h, d],
            "accent" if kind == "rug" else "wood",
        )
        if kind in {"cabinet", "counter"}:
            b("柜门中缝", [0, h / 2, d / 2 + 0.001], [0.008, h * 0.9, 0.004], "dark")
        if kind == "counter":
            b("操作台面", [0, h - 0.01, 0], [w, 0.03, d], "stone")
            kitchen_details(builder, item)
    return True
