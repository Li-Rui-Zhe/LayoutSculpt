"""常用家具的结构细化；所有细节均为可旋转观察的真实网格。"""

import math

import numpy as np
import trimesh


def outline(w, d, radius, count=12):
    r = min(radius, w / 2, d / 2)
    return np.array(
        [
            [cx + r * math.cos(a), cz + r * math.sin(a)]
            for cx, cz, start in [
                (w / 2 - r, d / 2 - r, 0),
                (-w / 2 + r, d / 2 - r, 90),
                (-w / 2 + r, -d / 2 + r, 180),
                (w / 2 - r, -d / 2 + r, 270),
            ]
            for a in np.radians(np.linspace(start, start + 90, count, endpoint=False))
        ]
    )


def plate(m, name, p, size, role="oak", radius=0.10):
    w, h, d = size
    rim = outline(w, d, radius)
    n = len(rim)
    vertices = [[x, y, z] for y in [-h / 2, h / 2] for x, z in rim]
    vertices += [[0, -h / 2, 0], [0, h / 2, 0]]
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces += [
            [2 * n, j, i],
            [2 * n + 1, n + i, n + j],
            [i, j, n + j],
            [i, n + j, n + i],
        ]
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
    mesh.fix_normals()
    mesh.apply_translation(p)
    m.add(name, mesh, role)


def soft(m, name, p, size, role="linen", exponent=0.42, tilt=0):
    mesh = trimesh.creation.uv_sphere(radius=1, count=[20, 32])
    v = mesh.vertices
    v = np.sign(v) * np.abs(v) ** exponent * np.array(size) / 2
    # 浅浅的布料起伏，避免枕头和软包像倒角塑料块。
    v[:, 1] += (
        0.003
        * np.sin(v[:, 0] * 35)
        * np.cos(v[:, 2] * 22)
        * np.maximum(0, 1 - np.abs(v[:, 1]) / (size[1] / 2 + 0.001))
    )
    mesh.vertices = v
    if tilt:
        mesh.apply_transform(trimesh.transformations.rotation_matrix(tilt, [1, 0, 0]))
    mesh.apply_translation(p)
    m.add(name, mesh, role, smooth=True)


def piping(m, name, p, w, d, role="cream", radius=0.06, thickness=0.0025):
    points = outline(w, d, radius, 8)
    for a, b in zip(points, np.roll(points, -1, axis=0)):
        m.rod(
            name,
            [a[0] + p[0], p[1], a[1] + p[2]],
            [b[0] + p[0], p[1], b[1] + p[2]],
            thickness,
            role,
        )


def cloth(m, name, width, depth, y, z, role, drop=0.09, *, x=0):
    nx, nz = 32, 32
    vertices = []
    for lower in [False, True]:
        for zz in np.linspace(-1, 1, nz):
            for xx in np.linspace(-1, 1, nx):
                edge = max(0, (abs(xx) - 0.89) / 0.11)
                foot = max(0, (zz - 0.89) / 0.11)
                wrinkle = 0.003 * math.sin(xx * 16 + zz * 5) + 0.002 * math.cos(
                    zz * 19 - xx * 6
                )
                yy = y - drop * max(edge, foot) + wrinkle - (0.017 if lower else 0)
                vertices.append([x + xx * width / 2, yy, z + zz * depth / 2])
    faces = []
    n = nx * nz
    for j in range(nz - 1):
        for i in range(nx - 1):
            a = j * nx + i
            faces += [
                [a, a + nx, a + 1],
                [a + 1, a + nx, a + nx + 1],
                [a + n, a + 1 + n, a + nx + n],
                [a + 1 + n, a + nx + 1 + n, a + nx + n],
            ]
    perimeter = (
        list(range(nx))
        + [j * nx + nx - 1 for j in range(1, nz)]
        + list(range(n - 2, n - nx - 1, -1))
        + [j * nx for j in range(nz - 2, 0, -1)]
    )
    for a, b in zip(perimeter, perimeter[1:] + perimeter[:1]):
        faces += [[a, b, b + n], [a, b + n, a + n]]
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
    mesh.fix_normals()
    m.add(name, mesh, role, smooth=True)


def bed(m, w, d, h, shape, role):
    top = 0.49 if shape == "bed" else 0.36
    frame = top - 0.19
    m.legs(w - 0.20, d - 0.22, frame - 0.045, "walnut", inset=0.08, center_z=0.03)
    plate(m, "实木圆角床框", [0, frame, 0.035], [w, 0.12, d - 0.07], "oak", 0.09)
    plate(
        m,
        "内缩床托",
        [0, frame + 0.07, 0.045],
        [w - 0.10, 0.035, d - 0.16],
        "walnut",
        0.075,
    )
    soft(
        m,
        "一体软包床头",
        [0, h * 0.54, -d / 2 + 0.065],
        [w, h * 0.92, 0.13],
        role,
        0.25,
    )
    for x in [0] if w < 1.3 else [-w * 0.235, w * 0.235]:
        soft(
            m,
            "弧面靠背",
            [x, h * 0.67, -d / 2 + 0.14],
            [w * 0.88 if w < 1.3 else w * 0.455, h * 0.51, 0.10],
            role,
            0.42,
        )
    md = d - 0.29
    mz = 0.075
    plate(m, "独立弹簧床垫", [0, top - 0.085, mz], [w - 0.10, 0.21, md], "white", 0.09)
    for yy in [top - 0.175, top + 0.006]:
        piping(m, "床垫滚边", [0, yy, mz], w - 0.095, md + 0.002, "cream", 0.09)
    cloth(m, "自然垂边被褥", w - 0.055, d - 0.68, top + 0.05, 0.31, "cream", 0.075)
    soft(
        m,
        "翻折被沿",
        [0, top + 0.067, -d / 2 + 0.70],
        [w - 0.15, 0.06, 0.19],
        "white",
        0.42,
    )
    for x in [0] if w < 1.3 else [-w * 0.235, w * 0.235]:
        pw = min(0.68, w * 0.74) if w < 1.3 else w * 0.41
        soft(
            m,
            "蓬松睡枕",
            [x, top + 0.09, -d / 2 + 0.40],
            [pw, 0.16, 0.40],
            "white",
            0.55,
            tilt=-0.10,
        )
        piping(
            m,
            "枕套包边",
            [x, top + 0.065, -d / 2 + 0.40],
            pw * 0.95,
            0.37,
            "cream",
            0.09,
            0.0018,
        )
    cloth(
        m,
        "床尾织物搭毯",
        w - 0.045,
        0.43,
        top + 0.083,
        d / 2 - 0.32,
        "linen" if role == "sage" else "sage",
        0.09,
    )


def nursery(m, w, d, h, shape):
    if shape == "crib":
        # 通透四面栏杆、无松散枕头床围，暖白细框配浅木扶手。
        for x in [-w / 2 + 0.035, w / 2 - 0.035]:
            for z in [-d / 2 + 0.035, d / 2 - 0.035]:
                m.box("圆角立柱", [x, h / 2, z], [0.055, h, 0.055], "paint", 0.022)
        plate(m, "内嵌床托", [0, 0.30, 0], [w - 0.075, 0.065, d - 0.075], "oak", 0.06)
        plate(m, "贴合床垫", [0, 0.37, 0], [w - 0.10, 0.075, d - 0.10], "white", 0.055)
        for x in [-w / 2 + 0.033, w / 2 - 0.033]:
            for yy, mat in [(0.33, "paint"), (h - 0.025, "oak")]:
                m.box("侧栏圆润横框", [x, yy, 0], [0.052, 0.052, d - 0.045], mat, 0.023)
            for z in np.linspace(
                -d / 2 + 0.11, d / 2 - 0.11, max(3, round((d - 0.22) / 0.065) + 1)
            ):
                m.rod("侧栏圆杆", [x, 0.345, z], [x, h - 0.04, z], 0.009, "paint")
        for z in [-d / 2 + 0.033, d / 2 - 0.033]:
            for yy, mat in [(0.33, "paint"), (h - 0.025, "oak")]:
                m.box("端栏横框", [0, yy, z], [w - 0.045, 0.052, 0.052], mat, 0.023)
            for x in np.linspace(
                -w / 2 + 0.11, w / 2 - 0.11, max(3, round((w - 0.22) / 0.065) + 1)
            ):
                m.rod("端栏圆杆", [x, 0.345, z], [x, h - 0.04, z], 0.009, "paint")
    else:
        for x in [-w / 2 + 0.038, w / 2 - 0.038]:
            for z in [-d / 2 + 0.04, d / 2 - 0.04]:
                m.box("圆角承重立柱", [x, h / 2, z], [0.075, h, 0.08], "oak", 0.02)
        for y in [0.28, 1.22]:
            plate(m, "实木床框", [0, y, 0], [w - 0.05, 0.14, d - 0.05], "paint", 0.05)
            plate(
                m,
                "独立床垫",
                [0, y + 0.12, 0],
                [w - 0.14, 0.13, d - 0.16],
                "white",
                0.055,
            )
            cloth(m, "铺床织物", w - 0.13, d - 0.56, y + 0.196, 0.21, "linen", 0.035)
            soft(
                m,
                "睡枕",
                [0, y + 0.22, -d / 2 + 0.32],
                [w * 0.66, 0.12, 0.34],
                "cream",
                0.55,
            )
        for z in [-d / 2 + 0.04, d / 2 - 0.04]:
            for yy in [0.68, h - 0.045]:
                m.box("端栏顶沿", [0, yy, z], [w - 0.04, 0.065, 0.045], "oak", 0.022)
                low = 0.40 if yy < 1 else 1.34
                for x in np.linspace(-w / 2 + 0.16, w / 2 - 0.16, 6):
                    m.box(
                        "端栏竖条",
                        [x, (low + yy) / 2, z],
                        [0.048, yy - low, 0.025],
                        "paint",
                        0.009,
                    )
        # 梯口位于右侧床尾，护栏在梯口之前结束。
        for x in [-w / 2 + 0.026, w / 2 - 0.026]:
            end = d / 2 - 0.06 if x < 0 else d / 2 - 0.48
            start = -d / 2 + 0.045
            for yy in [1.42, h - 0.045]:
                m.box(
                    "上铺侧护栏",
                    [x, yy, (start + end) / 2],
                    [0.045, 0.065, end - start],
                    "oak",
                    0.018,
                )
            for z in np.linspace(start + 0.08, end - 0.06, 9):
                m.box("侧护栏细条", [x, 1.59, z], [0.026, 0.29, 0.043], "paint", 0.008)
        for z in [d / 2 - 0.44, d / 2 - 0.07]:
            m.rod(
                "梯子侧梁",
                [w / 2 - 0.015, 0.018, z],
                [w / 2 - 0.015, 1.46, z],
                0.027,
                "oak",
            )
        for yy in [0.22, 0.46, 0.70, 0.94, 1.18]:
            m.box(
                "宽踏板",
                [w / 2 - 0.013, yy, d / 2 - 0.255],
                [0.10, 0.035, 0.40],
                "oak",
                0.012,
            )


def table(m, key, w, d, h, shape, role):
    if shape == "c_table":
        # 薄木面和开口钢管底架，可伸入沙发底部。
        plate(m, "薄木圆角台面", [0, h - 0.015, 0], [w, 0.03, d], "oak", 0.065)
        for z in [-d * 0.36, d * 0.36]:
            m.rod(
                "底部纵管",
                [-w * 0.43, 0.015, z],
                [w * 0.43, 0.015, z],
                0.014,
                "charcoal",
            )
            m.rod(
                "后侧立柱",
                [-w * 0.40, 0.015, z],
                [-w * 0.40, h - 0.036, z],
                0.014,
                "charcoal",
            )
            m.rod(
                "桌下承托",
                [-w * 0.40, h - 0.036, z],
                [w * 0.40, h - 0.036, z],
                0.012,
                "charcoal",
            )
        m.rod(
            "底部横管",
            [-w * 0.43, 0.015, -d * 0.36],
            [-w * 0.43, 0.015, d * 0.36],
            0.014,
            "charcoal",
        )
        return
    if shape == "coffee":
        plate(
            m,
            "圆润岩板桌面",
            [0, h - 0.018, 0],
            [w, 0.036, d],
            "stone",
            min(w, d) * 0.26,
        )
        plate(m, "内收实木下层", [0, 0.12, 0], [w - 0.14, 0.026, d - 0.12], "oak", 0.14)
        for x in [-w * 0.35, w * 0.35]:
            for z in [-d * 0.30, d * 0.30]:
                m.rod(
                    "斜实木支脚",
                    [x * 1.07, 0.021, z * 1.07],
                    [x, h - 0.037, z],
                    0.028,
                    "oak",
                )
        return
    tables = (
        [(0, w / 2, h)]
        if shape == "round"
        else [(-w * 0.17, d / 2, h), (w * 0.28, d * 0.31, h * 0.70)]
    )
    for x, rad, hh in tables:
        m.disk(
            "薄边圆桌面",
            [x, hh - 0.018, 0],
            rad,
            0.036,
            "oak" if key == "balcony_table" else role,
        )
        m.disk("桌面底托", [x, hh - 0.047, 0], rad * 0.53, 0.027, "oak")
        for a in np.linspace(0, 2 * math.pi, 3 if rad < 0.5 else 4, endpoint=False):
            foot = np.array([math.cos(a), math.sin(a)]) * rad * 0.69
            upper = np.array([math.cos(a), math.sin(a)]) * rad * 0.40
            m.rod(
                "外撇实木桌腿",
                [x + foot[0], 0.02, foot[1]],
                [x + upper[0], hh - 0.05, upper[1]],
                0.022 if hh < 0.5 else 0.028,
                "oak",
            )
        if key == "balcony_table":
            for a in np.linspace(0, 2 * math.pi, 3, endpoint=False):
                m.rod(
                    "桌腿连接撑",
                    [x, 0.25, 0],
                    [x + math.cos(a) * rad * 0.59, 0.25, math.sin(a) * rad * 0.59],
                    0.012,
                    "oak",
                )


def rack(m, w, d, h):
    half = w * 0.24
    y = h * 0.78
    zspan = d * 0.46
    for z in [-zspan, zspan]:
        for side in [-1, 1]:
            m.rod(
                "X型承重腿",
                [side * half, 0.025, z],
                [-side * half, y, z],
                0.017,
                "steel",
            )
            m.box(
                "防滑脚套",
                [side * half, 0.025, z],
                [0.095, 0.045, 0.053],
                "charcoal",
                0.018,
            )
        m.rod(
            "交叉铰链", [0, y / 2, z - 0.019], [0, y / 2, z + 0.019], 0.027, "charcoal"
        )
        m.rod("水平主框", [-half, y, z], [half, y, z], 0.016, "steel")
        for side in [-1, 1]:
            m.rod(
                "折叠翼外框",
                [side * half, y, z],
                [side * (w / 2 - 0.018), h - 0.015, z],
                0.016,
                "steel",
            )
            m.rod(
                "翼板托臂",
                [side * 0.08, y * 0.55, z],
                [side * w * 0.37, y + (h - y) * 0.5, z],
                0.009,
                "steel",
            )
    for x in [-half, half]:
        m.rod("中段端框", [x, y, -zspan], [x, y, zspan], 0.016, "steel")
    for x in np.linspace(-half + 0.06, half - 0.06, 7):
        m.rod("中央晾晒杆", [x, y, -zspan], [x, y, zspan], 0.007, "steel")
    for side in [-1, 1]:
        for x in np.linspace(half + 0.055, w / 2 - 0.02, 5):
            yy = y + (x - half) / (w / 2 - 0.018 - half) * (h - 0.015 - y)
            m.rod(
                "翼板晾晒杆",
                [side * x, yy, -zspan],
                [side * x, yy, zspan],
                0.007,
                "steel",
            )
        m.rod(
            "落地连接管",
            [side * half, 0.03, -zspan],
            [side * half, 0.03, zspan],
            0.012,
            "steel",
        )
        m.box(
            "翼端保护套",
            [side * (w / 2 - 0.018), h - 0.015, 0],
            [0.035, 0.035, d * 0.97],
            "cream",
            0.015,
        )


def daybed(m, w, d, h, role):
    """A continuous lounging surface on an open, connected timber frame."""
    m.legs(w - 0.08, d - 0.08, 0.25, "oak", inset=0.09)
    plate(m, "实木承重底座", [0, 0.28, 0], [w, 0.10, d], "oak", 0.055)
    plate(
        m, "内缩床垫托板", [0, 0.335, 0.01], [w - 0.10, 0.025, d - 0.09], "oak", 0.045
    )

    mw, md, mz = w - 0.16, d - 0.13, 0.015
    soft(m, "整张躺卧软垫", [0, 0.423, mz], [mw, 0.18, md], role, 0.34)
    for y in [0.362, 0.484]:
        piping(
            m,
            "软垫细滚边",
            [0, y, mz],
            mw - 0.024,
            md - 0.024,
            role,
            radius=0.055,
            thickness=0.002,
        )

    rear, front, side = -d / 2 + 0.035, d / 2 - 0.035, w / 2 - 0.035
    top, arm = h - 0.025, 0.61
    for x in [-side, side]:
        m.box(
            "后围框立柱",
            [x, (0.30 + top) / 2, rear],
            [0.05, top - 0.30, 0.05],
            "oak",
            0.008,
        )
        m.box(
            "端部前立柱",
            [x, (0.30 + arm) / 2, front],
            [0.05, arm - 0.30, 0.05],
            "oak",
            0.008,
        )
        m.rod("圆润侧扶手", [x, arm, rear], [x, arm, front], 0.025, "oak")
        m.box("侧围框下横撑", [x, 0.37, 0], [0.035, 0.04, d - 0.07], "oak", 0.007)
        for z in [-d * 0.26, 0, d * 0.26]:
            m.box("通透侧围木条", [x, 0.49, z], [0.025, 0.22, 0.028], "oak", 0.006)
    m.rod("圆润后围扶手", [-side, top, rear], [side, top, rear], 0.025, "oak")
    m.box("后围框下横撑", [0, 0.37, rear], [w - 0.07, 0.04, 0.035], "oak", 0.007)
    for x in np.linspace(-side + 0.10, side - 0.10, 15):
        m.box(
            "通透靠背木条",
            [x, (0.39 + top - 0.01) / 2, rear],
            [0.026, top - 0.40, 0.028],
            "oak",
            0.006,
        )

    # Place the head pillow at one end instead of across the lounging surface.
    soft(
        m, "可移位头枕", [-w * 0.315, 0.575, mz], [0.46, 0.17, md * 0.73], "cream", 0.55
    )
    cloth(m, "床尾轻搭毯", 0.43, d - 0.10, 0.523, mz, "linen", drop=0.055, x=w * 0.28)


def refined(m, spec):
    key, _, _, _, _, _, (w, d, h), shape, role = spec
    if shape == "daybed":
        daybed(m, w, d, h, role)
    elif shape in {"bed", "platform"}:
        bed(m, w, d, h, shape, role)
    elif shape in {"bunk", "crib"}:
        nursery(m, w, d, h, shape)
    elif shape in {"coffee", "c_table", "round", "nested"}:
        table(m, key, w, d, h, shape, role)
    elif shape == "rack":
        rack(m, w, d, h)
    else:
        return False
    return True
