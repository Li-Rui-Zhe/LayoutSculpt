"""落地挂衣架及桌面电脑的原创几何，Y 向上、正面 +Z，单位米。"""

from tools.computer_models import desktop, laptop


def hanging_rack(m, w, d, h, single=False):
    if single:
        for x in [-w * 0.39, w * 0.39]:
            m.rod(
                "T型落地横脚",
                [x, 0.055, -d / 2 + 0.035],
                [x, 0.055, d / 2 - 0.035],
                0.024,
                "steel",
            )
            for z in [-d / 2 + 0.035, d / 2 - 0.035]:
                m.box("防滑脚垫", [x, 0.026, z], [0.11, 0.052, 0.075], "paint", 0.018)
            m.rod("下段立柱", [x, 0.055, 0], [x, h * 0.57, 0], 0.021, "steel")
            m.rod("伸缩立柱", [x, h * 0.54, 0], [x, h - 0.025, 0], 0.016, "steel")
            m.rod("伸缩锁紧套", [x, h * 0.54, 0], [x, h * 0.57, 0], 0.027, "charcoal")
        m.rod("底部连接横梁", [-w * 0.39, 0.08, 0], [w * 0.39, 0.08, 0], 0.019, "steel")
        m.rod(
            "加粗挂衣横杆",
            [-w / 2 + 0.018, h - 0.025, 0],
            [w / 2 - 0.018, h - 0.025, 0],
            0.022,
            "steel",
        )
        for x in [-w / 2 + 0.018, w / 2 - 0.018]:
            m.rod(
                "横杆防脱端帽",
                [x - 0.009, h - 0.025, 0],
                [x + 0.009, h - 0.025, 0],
                0.029,
                "paint",
            )
        return

    top_y, top_z, foot_z = h - 0.025, d * 0.29, d / 2 - 0.025
    xspan = w / 2 - 0.055
    pivot_y = 0.04 + (top_y - 0.04) * foot_z / (foot_z + top_z)
    for x in [-xspan, xspan]:
        for side in [-1, 1]:
            # 两端各一组 X 脚，顶部双横杆沿宽度贯通，留出挂长衣的空间。
            m.rod(
                "X型斜撑立柱",
                [x, 0.04, side * foot_z],
                [x, top_y, -side * top_z],
                0.019,
                "steel",
            )
            m.box(
                "落地防滑脚套",
                [x, 0.027, side * foot_z],
                [0.085, 0.054, 0.065],
                "charcoal",
                0.014,
            )
            if x < 0:
                m.rod(
                    "双杆挂衣横梁",
                    [-w / 2 + 0.022, top_y, side * top_z],
                    [w / 2 - 0.022, top_y, side * top_z],
                    0.022,
                    "steel",
                )
            m.rod(
                "横梁保护端帽",
                [x - 0.031, top_y, side * top_z],
                [x + 0.031, top_y, side * top_z],
                0.027,
                "charcoal",
            )
        m.rod(
            "交叉铰链轴",
            [x - 0.025, pivot_y, 0],
            [x + 0.025, pivot_y, 0],
            0.034,
            "charcoal",
        )
        m.rod(
            "铰链螺栓", [x - 0.03, pivot_y, 0], [x + 0.03, pivot_y, 0], 0.014, "steel"
        )
        m.rod(
            "侧面限位撑",
            [x, h * 0.31, -d * 0.19],
            [x, h * 0.31, d * 0.19],
            0.011,
            "steel",
        )
    m.rod("中部加固横梁", [-xspan, pivot_y, 0], [xspan, pivot_y, 0], 0.017, "steel")


def equipment(m, spec):
    _, _, _, _, _, _, (w, d, h), shape, _ = spec
    if shape in {"hanging_rack", "single_rack"}:
        hanging_rack(m, w, d, h, single=shape == "single_rack")
    elif shape == "desktop":
        desktop(m)
    elif shape == "laptop":
        laptop(m)
    else:
        return False
    return True
