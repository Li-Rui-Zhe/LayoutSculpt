"""贴合真实沙发网格的搭毯，避免凭坐标绘制薄片穿进坐垫。"""
import numpy as np
import trimesh


def curtain_panel(width=.62, height=2.57, *, mirror=False):
    """一整幅有厚度的垂帘：顶部收褶、下摆展开，避免用独立棱柱冒充布料。"""
    columns, rows = 49, 13
    vertices, uv, faces = [], [], []
    for row, t in enumerate(np.linspace(0, 1, rows)):
        for col, u in enumerate(np.linspace(0, 1, columns)):
            # t=0 is the gathered header; broad folds loosen toward the floor.
            spread = .83 + .17 * t
            phase = u * np.pi * 10 + .20 * np.sin(t * np.pi) * np.sin(u * np.pi)
            x = (u - .5) * width * spread + .015 * np.sin(t * np.pi)
            y = height * (1 - t) + .008 * t ** 8 * (1 - np.cos(phase))
            z = (.035 + .015 * t) * np.cos(phase) + .008 * np.sin(t * np.pi * 1.5)
            vertices.append(((-x if mirror else x), y, z))
            uv.append((u * width / .25, (1 - t) * height / .25))
    for row in range(rows - 1):
        for col in range(columns - 1):
            a = row * columns + col
            faces.extend([(a, a + 1, a + columns), (a + 1, a + columns + 1, a + columns)])
    front = np.array(vertices)
    count = len(front)
    back = front + [0, 0, -.003]
    closed = [*faces, *[(c + count, b + count, a + count) for a, b, c in faces]]
    perimeter = [*range(columns), *[r * columns + columns - 1 for r in range(1, rows)],
                 *range(count - 2, count - columns - 1, -1),
                 *[r * columns for r in range(rows - 2, 0, -1)]]
    for i, a in enumerate(perimeter):
        b = perimeter[(i + 1) % len(perimeter)]
        closed.extend([(a, a + count, b), (b, a + count, b + count)])
    mesh = trimesh.Trimesh(vertices=np.vstack([front, back]), faces=closed, process=False)
    mesh.fix_normals()
    return mesh, np.vstack([uv, uv])


def upper_surface(triangles, points):
    """Vertical surface samples without an optional ray-tracing dependency."""
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    denominator = (b[:, 2] - c[:, 2]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 2] - c[:, 2])
    usable = np.abs(denominator) > 1e-10
    a, b, c, denominator = a[usable], b[usable], c[usable], denominator[usable]
    heights = []
    for x, z in points:
        u = ((b[:, 2] - c[:, 2]) * (x - c[:, 0]) + (c[:, 0] - b[:, 0]) * (z - c[:, 2])) / denominator
        v = ((c[:, 2] - a[:, 2]) * (x - c[:, 0]) + (a[:, 0] - c[:, 0]) * (z - c[:, 2])) / denominator
        w = 1 - u - v
        hit = (u >= -1e-7) & (v >= -1e-7) & (w >= -1e-7)
        heights.append(np.max((u * a[:, 1] + v * b[:, 1] + w * c[:, 1])[hit]) if hit.any() else np.nan)
    return np.array(heights)


def sofa_triangles(scene):
    triangles = []
    for (_, node), edge in scene.graph.transforms.edge_data.items():
        if edge.get("metadata", {}).get("builtin_kind") != "sofa":
            continue
        transform, geometry = scene.graph[node]
        mesh = scene.geometry[geometry].copy()
        mesh.apply_transform(transform)
        triangles.append(mesh.triangles)
    if not triangles:
        raise ValueError("示例中未找到真实沙发网格，不能放置搭毯")
    return np.concatenate(triangles)


def draped_throw(triangles, cx, cz):
    # A narrow, folded runner stays within the middle cushion, clear of seams.
    front = triangles[:, :, 0].max()
    zcenter = 4.60 - cz
    width = .58
    radius = .085
    xcurve = front - .055
    xs = np.linspace(1.14 - cx, xcurve, 42)
    zs = zcenter + np.linspace(-width / 2, width / 2, 35)
    samples = upper_surface(triangles, [(x, z) for x in xs for z in zs]).reshape(len(xs), len(zs))
    if not np.isfinite(samples).all():
        raise ValueError("搭毯座面超出沙发实际支撑范围")
    # Bridge tiny upholstery grooves instead of reproducing them as jagged holes.
    profile = samples.max(axis=1) + .009
    profile = np.maximum(profile, np.convolve(np.pad(profile, (3, 3), mode="edge"), np.ones(7) / 7, mode="valid"))
    level = max(profile[-1], float(samples.max()) + .009)
    profile[-10:] = np.maximum(profile[-10:], level)
    path = [(x, y) for x, y in zip(xs, profile)]
    for angle in np.linspace(0, np.pi / 2, 25)[1:]:
        path.append((xcurve + radius * np.sin(angle), level - radius + radius * np.cos(angle)))
    for t in np.linspace(0, 1, 28)[1:]:
        path.append((xcurve + radius + .007 * np.sin(np.pi * t), (level - radius) * (1 - t) + .225 * t))
    path = np.array(path)
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))]
    vertices, uv = [], []
    for row, (x, y) in enumerate(path):
        hanging = max(0, (row - len(xs)) / (len(path) - len(xs)))
        for col, z in enumerate(zs):
            u = col / (len(zs) - 1)
            # Only a few broad, soft folds. Edges remain a continuous rectangle.
            fold = np.sin(u * np.pi * 3) * np.sin(u * np.pi)
            # 软垫有轻微横向曲率，整行取最高点会让边缘悬空。
            # 保留跨缝支撑，同时让座面逐列贴合真实网格；转折处平滑接回垂落轮廓。
            local_y = y
            if row < len(xs):
                blend = min(1, (len(xs) - 1 - row) / 5)
                fitted = max(samples[row, col] + .009, y - .007)
                local_y = y + (fitted - y) * blend
            vertices.append((x + .007 * hanging * fold, local_y + .002 * (1 - hanging) * fold, z))
            uv.append((u * width / .25, arc[row] / .25))
    faces = []
    columns = len(zs)
    for row in range(len(path) - 1):
        for col in range(columns - 1):
            a = row * columns + col
            faces.extend([(a, a + 1, a + columns), (a + 1, a + columns + 1, a + columns)])
    surface = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    # Two-sided thickness, with a closed sewn perimeter; no razor-thin open sheet.
    normals = surface.vertex_normals
    count = len(vertices)
    vertices = np.vstack([surface.vertices, surface.vertices - normals * .003])
    solid_faces = [*faces, *[(c + count, b + count, a + count) for a, b, c in faces]]
    perimeter = [*range(columns), *[row * columns + columns - 1 for row in range(1, len(path))],
                 *range(count - 2, count - columns - 1, -1),
                 *[row * columns for row in range(len(path) - 2, 0, -1)]]
    for i, a in enumerate(perimeter):
        b = perimeter[(i + 1) % len(perimeter)]
        solid_faces.extend([(a, a + count, b), (b, a + count, b + count)])
    mesh = trimesh.Trimesh(vertices=vertices, faces=solid_faces, process=False)
    mesh.fix_normals()
    return mesh, np.vstack([uv, uv])
