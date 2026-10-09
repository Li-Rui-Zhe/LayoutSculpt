"""餐椅共用造型定义：Y 向上，+Z 为正面；仅使用标准库供 Blender 与 GLB 建库复用。"""
import math


def rounded_ring(width, height, radius, steps=8):
    points = []
    for cx, cy, start in [
        (width / 2 - radius, height / 2 - radius, 0),
        (-width / 2 + radius, height / 2 - radius, 90),
        (-width / 2 + radius, -height / 2 + radius, 180),
        (width / 2 - radius, -height / 2 + radius, 270),
    ]:
        for i in range(steps + 1):
            a = math.radians(start + i * 90 / steps)
            points.append((cx + radius * math.cos(a), cy + radius * math.sin(a)))
    return points


def loft(name, role, rings, cap_surface=None):
    count = len(rings[0])
    vertices = [p for ring in rings for p in ring]
    faces = []
    for j in range(len(rings) - 1):
        for i in range(count):
            a, b = j * count + i, j * count + (i + 1) % count
            faces.extend([(a, b, b + count), (a, b + count, a + count)])
    for ring_index, reverse in [(0, True), (len(rings) - 1, False)]:
        ring = rings[ring_index]
        center = tuple(sum(p[axis] for p in ring) / count for axis in range(3))
        vertices.append(center)
        c = len(vertices) - 1
        if cap_surface:
            previous = [ring_index * count + i for i in range(count)]
            for step in range(1, 9):
                scale = 1 - step / 9
                current = []
                for point in ring:
                    value = tuple(center[axis] + (point[axis] - center[axis]) * scale for axis in range(3))
                    current.append(len(vertices))
                    vertices.append(cap_surface(value, ring_index == 0))
                for i in range(count):
                    j = (i + 1) % count
                    pair = [(previous[i], previous[j], current[j]), (previous[i], current[j], current[i])]
                    faces.extend((a, c, b) if reverse else (a, b, c) for a, b, c in pair)
                previous = current
            vertices[c] = cap_surface(center, ring_index == 0)
            for i in range(count):
                a, b = previous[i], previous[(i + 1) % count]
                faces.append((c, b, a) if reverse else (c, a, b))
            continue
        for i in range(count):
            a, b = ring_index * count + i, ring_index * count + (i + 1) % count
            faces.append((c, b, a) if reverse else (c, a, b))
    if cap_surface:
        unique, lookup, indices = [], {}, []
        for vertex in vertices:
            key = tuple(round(value, 10) for value in vertex)
            if key not in lookup:
                lookup[key] = len(unique)
                unique.append(vertex)
            indices.append(lookup[key])
        vertices = unique
        faces = [tuple(indices[index] for index in face) for face in faces]
    volume6 = sum(
        vertices[a][0] * (vertices[b][1] * vertices[c][2] - vertices[b][2] * vertices[c][1])
        + vertices[a][1] * (vertices[b][2] * vertices[c][0] - vertices[b][0] * vertices[c][2])
        + vertices[a][2] * (vertices[b][0] * vertices[c][1] - vertices[b][1] * vertices[c][0])
        for a, b, c in faces
    )
    if volume6 < 0:
        faces = [(a, c, b) for a, b, c in faces]
    return {"name": name, "role": role, "vertices": vertices, "faces": faces}


def chair_parts():
    parts = []
    # Seat height is 0.475 m. The cushion has rounded edges and a gently crowned
    # upper surface, supported by four apron rails rather than balancing on poles.
    rings = []
    for y, w, d, radius in [
        (.410, .454, .413, .056), (.417, .480, .439, .064),
        (.433, .500, .459, .074), (.452, .500, .459, .074),
        (.466, .485, .444, .068), (.474, .457, .416, .06),
        (.477, .380, .340, .05),
    ]:
        rings.append([(x, y, z + .015) for x, z in rounded_ring(w, d, radius)])
    parts.append(loft("整块圆角软包座垫", "fabric", rings))

    # A single upholstered panel, gently curved around the sitter and reclined
    # toward the back. No disconnected top rail or tiny floating back cushion.
    rings = []
    for depth, inset in [(-.027, .015), (-.022, .004), (-.011, 0),
                         (.011, 0), (.022, .006), (.025, .018)]:
        ring = []
        outline = rounded_ring(.460 - inset * 2, .307 - inset * 2, .052)
        # Sample the long edges too so the curved front is a smooth surface.
        dense = []
        for i, (x, y) in enumerate(outline):
            nx, ny = outline[(i + 1) % len(outline)]
            for j in range(8):
                dense.append((x + (nx - x) * j / 8, y + (ny - y) * j / 8))
        for u, v in dense:
            y = .6865 + v
            x = u * (1 + .18 * v)
            z = -.210 - .16 * (y - .535) + .062 * (x / .230) ** 2 + depth
            ring.append((x, y, z))
        rings.append(ring)
    def back_surface(point, rear):
        x, y, _ = point
        return (x, y, -.210 - .16 * (y - .535) + .062 * (x / .230) ** 2 + (-.027 if rear else .025))
    parts.append(loft("完整弧面软包靠背", "fabric", rings, back_surface))

    for side in [-1, 1]:
        for rear in [False, True]:
            levels = ([(0, side * .207, -.249, .012),
                       (.02, side * .207, -.248, .014),
                       (.405, side * .180, -.166, .021),
                       (.57, side * .174, -.206, .019),
                       (.650, side * .170, -.211, .017)] if rear else
                      [(0, side * .211, .241, .012),
                       (.02, side * .210, .24, .014),
                       (.410, side * .180, .174, .021)])
            rings = [[(x + dx, y, z + dz) for dx, dz in rounded_ring(r * 2, r * 2, r * .30, 4)]
                     for y, x, z, r in levels]
            parts.append(loft(f"{'左' if side < 0 else '右'}{'后腿连靠背支柱' if rear else '前实木椅腿'}", "wood", rings))

    for name, cx, cz, w, d in [
        ("前座框", 0, .172, .380, .030), ("后座框", 0, -.164, .380, .030),
        ("左座框", -.180, .004, .030, .366), ("右座框", .180, .004, .030, .366),
    ]:
        rings = [[(x + cx, y, z + cz) for x, z in rounded_ring(w, d, .007, 4)] for y in [.371, .416]]
        parts.append(loft(name, "wood", rings))

    # Keep the published size and pivot stable so existing placements still fit.
    vertices = [v for part in parts for v in part["vertices"]]
    low = [min(v[i] for v in vertices) for i in range(3)]
    high = [max(v[i] for v in vertices) for i in range(3)]
    target = [.50, .84, .54]
    origin = [(low[0] + high[0]) / 2, low[1], (low[2] + high[2]) / 2]
    for part in parts:
        part["vertices"] = [tuple((v[i] - origin[i]) * target[i] / (high[i] - low[i]) for i in range(3)) for v in part["vertices"]]
    return parts
