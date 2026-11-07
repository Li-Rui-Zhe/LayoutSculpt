"""常用家具的结构细化；所有细节均为可旋转观察的真实网格。"""

import math

import numpy as np
import trimesh
from mapbox_earcut import triangulate_float64

from tools.chair_mesh import loft


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
    # 桌板保留真实外廓；上下缘的毫米级倒角让斜光产生连续高光。
    bevel = min(0.004, h * 0.16, w * 0.04, d * 0.04)
    rings = [
        (-h / 2, bevel),
        (-h / 2 + bevel, 0),
        (h / 2 - bevel, 0),
        (h / 2, bevel),
    ]
    n = len(outline(w, d, radius))
    vertices = [
        [x, y, z]
        for y, inset in rings
        for x, z in outline(w - 2 * inset, d - 2 * inset, max(0.001, radius - inset))
    ]
    vertices += [[0, -h / 2, 0], [0, h / 2, 0]]
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces += [
            [4 * n, j, i],
            [4 * n + 1, 3 * n + i, 3 * n + j],
        ]
        for ring in range(3):
            a, b = ring * n, (ring + 1) * n
            faces += [[a + i, a + j, b + j], [a + i, b + j, b + i]]
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
    """Low timber deck, a reclined back rail and a continuous upholstered seat."""
    for x in [-w * 0.416, w * 0.416]:
        for z in [-d * 0.379, d * 0.379]:
            m.box("圆边实木支脚", [x, 0.107, z], [0.063, 0.214, 0.063], "oak", 0.009)
    m.box("跨中承托支脚", [0, 0.107, 0], [0.055, 0.214, 0.058], "oak", 0.007)
    plate(m, "薄边实木底座", [0, 0.240, 0], [w, 0.072, d], "oak", 0.053)

    mw, md, seat_z = w - 0.115, d - 0.106, 0.021
    cushion_sections = [
        (0.270, 0.039, 0.065),
        (0.282, 0.015, 0.064),
        (0.307, 0.002, 0.068),
        (0.411, 0.000, 0.070),
        (0.429, 0.005, 0.073),
        (0.446, 0.021, 0.076),
        (0.454, 0.059, 0.081),
    ]
    rings = [
        [(x, y, z + seat_z) for x, z in outline(mw - 2 * inset, md - 2 * inset, radius)]
        for y, inset, radius in cushion_sections
    ]
    seat = loft("微鼓面布艺躺卧软垫", role, rings)
    m.add(seat["name"], trimesh.Trimesh(seat["vertices"], seat["faces"]), role, smooth=True)
    piping(m, "布套上缘同色包缝", [0, 0.411, seat_z], mw, md, role, radius=0.070, thickness=0.0022)

    for x in [-w * 0.385, 0, w * 0.385]:
        m.rod("后倾靠背承力柱", [x, 0.254, -d * 0.372], [x, h - 0.038, -d * 0.452], 0.024, "oak")
    back_sections = [
        (h - 0.185, 0.085, -d * 0.422, 0.041),
        (h - 0.173, 0.062, -d * 0.430, 0.048),
        (h - 0.011, 0.064, -d * 0.469, 0.048),
        (h, 0.083, -d * 0.470, 0.038),
    ]
    rings = [
        [(x, y, z + center_z) for x, z in outline(w - 2 * inset, depth, 0.019)]
        for y, inset, center_z, depth in back_sections
    ]
    back = loft("一体圆边后倾实木靠背", "oak", rings)
    m.add(back["name"], trimesh.Trimesh(back["vertices"], back["faces"]), "oak")

    soft(m, "可拆长靠垫", [-w * 0.235, 0.575, -d * 0.290], [0.730, 0.282, 0.205], "linen", 0.47, tilt=-0.20)
    soft(m, "低靠垫", [w * 0.105, 0.553, -d * 0.279], [0.605, 0.235, 0.184], "cream", 0.52, tilt=-0.19)
    soft(m, "鼠尾草绿腰枕", [w * 0.302, 0.514, -d * 0.128], [0.392, 0.157, 0.172], "sage", 0.64, tilt=-0.15)


def corner_desk(m, w, d, h, role):
    left, right, back, front = -w / 2, w / 2, -d / 2, d / 2
    wing_edge, main_edge = left + 0.56, back + 0.63
    corners = np.array([
        [left, back], [right, back], [right, main_edge],
        [wing_edge, main_edge], [wing_edge, front], [left, front],
    ])
    radii = (0.034, 0.034, 0.048, 0.108, 0.048, 0.038)

    def rounded_perimeter(inset):
        points = []
        for i, (corner, radius) in enumerate(zip(corners, radii, strict=True)):
            incoming = corner - corners[i - 1]
            outgoing = corners[(i + 1) % len(corners)] - corner
            incoming /= np.linalg.norm(incoming)
            outgoing /= np.linalg.norm(outgoing)
            turn = incoming[0] * outgoing[1] - incoming[1] * outgoing[0]
            inward = np.array([-incoming[1] - outgoing[1], incoming[0] + outgoing[0]])
            offset_corner = corner + inward * inset
            radius -= turn * inset
            center = offset_corner + (outgoing - incoming) * radius
            angle = math.atan2(-outgoing[1], -outgoing[0])
            for theta in np.linspace(angle, angle + turn * math.pi / 2, 12):
                points.append(center + radius * np.array([math.cos(theta), math.sin(theta)]))
        return np.array(points)

    # One slab, including the inward curve and a continuous bevel around its edge.
    thickness, bevel = 0.039, 0.0038
    cap = rounded_perimeter(bevel)
    edge = rounded_perimeter(0)
    rings = [
        np.column_stack((points[:, 0], np.full(len(points), y), points[:, 1]))
        for y, points in [(h - thickness, cap), (h - thickness + bevel, edge), (h - bevel, edge), (h, cap)]
    ]
    n = len(cap)
    end_faces = triangulate_float64(cap, np.array([n], dtype=np.uint32)).reshape((-1, 3))
    a, b, c = cap[end_faces[0]]
    if np.linalg.det(np.stack((b - a, c - a))) < 0:
        end_faces = end_faces[:, ::-1]
    faces = [*end_faces.tolist(), *(end_faces[:, ::-1] + 3 * n).tolist()]
    for layer in range(3):
        for i in range(n):
            a, b = layer * n + i, layer * n + (i + 1) % n
            faces.extend([(a, b + n, b), (a, a + n, b + n)])
    slab = trimesh.Trimesh(vertices=np.vstack(rings), faces=faces)
    if not slab.is_volume:
        raise ValueError("转角桌板轮廓无法形成完整实体")
    m.add("一体倒圆 L 形木桌板", slab, role)

    tube = 0.042
    frame_top = h - 0.034
    post_low = 0.014
    post_h = frame_top - post_low
    end_x, end_z = right - 0.076, front - 0.076
    rear_z, inside_z = back + 0.074, main_edge - 0.063
    outer_x, inside_x = left + 0.074, wing_edge - 0.066
    posts = [(end_x, rear_z), (end_x, inside_z), (outer_x, end_z), (inside_x, end_z), (outer_x, rear_z)]
    for x, z in posts:
        m.box("粉末涂层方管立脚", [x, post_low + post_h / 2, z], [tube, post_h, tube], "charcoal", 0.004)
        m.box("可调防滑脚垫", [x, 0.008, z], [0.043, 0.016, 0.043], "dark", 0.003)
    for y in [0.047, h - 0.059]:
        m.box("主桌门形脚横杆", [end_x, y, (rear_z + inside_z) / 2], [tube, tube, inside_z - rear_z + tube], "charcoal", 0.004)
        m.box("副台门形脚横杆", [(outer_x + inside_x) / 2, y, end_z], [inside_x - outer_x + tube, tube, tube], "charcoal", 0.004)
    m.box("背侧连续承托梁", [(outer_x + end_x) / 2, h - 0.058, rear_z], [end_x - outer_x + tube, 0.049, tube], "charcoal", 0.004)
    m.box("转角外侧承托梁", [outer_x, h - 0.058, (rear_z + end_z) / 2], [tube, 0.049, end_z - rear_z + tube], "charcoal", 0.004)
    m.box("主桌前侧围梁", [(wing_edge + end_x) / 2, h - 0.059, inside_z], [end_x - wing_edge + tube, 0.048, tube], "charcoal", 0.004)
    m.box("桌角内侧连接片", [wing_edge - 0.043, h - 0.044, main_edge - 0.045], [0.18, 0.020, 0.16], "charcoal", 0.005)

    drawer_x, drawer_z = right - 0.270, main_edge - 0.225
    m.box("桌下浅抽内盒", [drawer_x, h - 0.090, drawer_z], [0.329, 0.106, 0.342], "charcoal", 0.008)
    m.box("独立浅抽木前板", [drawer_x, h - 0.095, drawer_z + 0.174], [0.346, 0.094, 0.023], role, 0.006)
    m.box("窄面金属抽拉手", [drawer_x, h - 0.095, drawer_z + 0.202], [0.128, 0.012, 0.009], "charcoal", 0.003)
    for x in [drawer_x - 0.049, drawer_x + 0.049]:
        m.box("浅抽拉手固定脚", [x, h - 0.095, drawer_z + 0.191], [0.011, 0.009, 0.017], "charcoal", 0.002)
    m.box("背侧理线托槽底板", [w * 0.19, h - 0.138, rear_z + 0.066], [0.440, 0.014, 0.100], "charcoal", 0.004)
    for z in [rear_z + 0.022, rear_z + 0.112]:
        m.box("理线槽挡边", [w * 0.19, h - 0.112, z], [0.440, 0.061, 0.014], "charcoal", 0.004)
    for x in [w * 0.19 - 0.164, w * 0.19 + 0.164]:
        m.box("理线槽固定夹", [x, h - 0.084, rear_z + 0.019], [0.032, 0.044, 0.038], "charcoal", 0.003)


def refined(m, spec):
    key, _, _, _, _, _, (w, d, h), shape, role = spec
    if shape == "daybed":
        daybed(m, w, d, h, role)
    elif shape == "corner":
        corner_desk(m, w, d, h, role)
    elif shape in {"bed", "platform"}:
        bed(m, w, d, h, shape, role)
    elif shape in {"bunk", "crib"}:
        nursery(m, w, d, h, shape)
    elif shape == "pedestal_table":
        m.disk("圆角实木桌面", [0, h - 0.020, 0], w / 2, 0.040, role)
        profile = [
            (0, 0), (0.252, 0), (0.274, 0.007), (0.285, 0.019),
            (0.278, 0.036), (0.229, 0.049), (0.172, 0.070),
            (0.134, 0.105), (0.116, 0.157), (0.112, 0.219),
            (0.112, h - 0.079), (0.131, h - 0.055),
            (0.148, h - 0.036), (0, h - 0.036),
        ]
        base = trimesh.creation.revolve(profile, sections=64)
        base.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
        m.add("一体圆柱承重底座", base, "paint")
    elif shape in {"coffee", "c_table", "round", "nested"}:
        table(m, key, w, d, h, shape, role)
    elif shape == "rack":
        rack(m, w, d, h)
    else:
        return False
    return True
