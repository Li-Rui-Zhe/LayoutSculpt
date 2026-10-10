"""Portable 2D exports. Coordinates remain in metres; DXF uses millimetres."""

import html
import math


def furniture_polygon(item):
    angle = math.radians(item.get("rotation", 0))
    c, s = math.cos(angle), math.sin(angle)
    return [
        {"x": item["x"] + x * c - y * s, "y": item["y"] + x * s + y * c}
        for x, y in [
            (-item["width"] / 2, -item["depth"] / 2),
            (item["width"] / 2, -item["depth"] / 2),
            (item["width"] / 2, item["depth"] / 2),
            (-item["width"] / 2, item["depth"] / 2),
        ]
    ]


def segments(data):
    """Cut wall axes at openings, keeping doors, windows and passages separate."""
    result = []
    for wall in data["walls"]:
        a, b = wall["start"], wall["end"]
        length = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
        if length <= 0:
            continue

        def point(t):
            return {k: a[k] + (b[k] - a[k]) * t / length for k in ("x", "y")}

        cursor = 0
        for opening in sorted(
            (o for o in data["openings"] if o["wall_id"] == wall["id"]),
            key=lambda o: o["offset"],
        ):
            start, end = opening["offset"], opening["offset"] + opening["width"]
            if start > cursor:
                result.append(("WALLS", point(cursor), point(start), wall["thickness"]))
            result.append(
                (
                    {"window": "WINDOWS", "door": "DOORS"}.get(
                        opening["kind"], "PASSAGES"
                    ),
                    point(start),
                    point(end),
                    0.04,
                )
            )
            cursor = max(cursor, end)
        if cursor < length:
            result.append(("WALLS", point(cursor), point(length), wall["thickness"]))
    return result


def plan_svg(data):
    outline = data["outline"]
    x, y = min(p["x"] for p in outline) - 0.5, min(p["y"] for p in outline) - 0.5
    width, height = (
        max(p["x"] for p in outline) - x + 0.5,
        max(p["y"] for p in outline) - y + 0.5,
    )
    nodes = []

    def polygon(points, fill, stroke):
        coords = " ".join(f"{p['x']},{p['y']}" for p in points)
        nodes.append(
            f'<polygon points="{coords}" fill="{fill}" stroke="{stroke}" stroke-width=".025"/>'
        )

    for room in data["rooms"]:
        polygon(room["polygon"], "#eee8db", "#bbb")
    for item in data.get("furniture", []):
        polygon(furniture_polygon(item), "#d0bc96", "#8d7e66")
    colors = {
        "WALLS": "#334d41",
        "WINDOWS": "#3295bd",
        "DOORS": "#aa8249",
        "PASSAGES": "#8ba278",
    }
    for layer, a, b, thickness in segments(data):
        nodes.append(
            f'<line x1="{a["x"]}" y1="{a["y"]}" x2="{b["x"]}" y2="{b["y"]}" stroke="{colors[layer]}" stroke-width="{thickness}"/>'
        )
    for room in data["rooms"]:
        points = room["polygon"]
        cx = sum(p["x"] for p in points) / len(points)
        cy = sum(p["y"] for p in points) / len(points)
        nodes.append(
            f'<text x="{cx}" y="{cy}" font-size=".18" text-anchor="middle" fill="#234932">{html.escape(room["name"])}</text>'
        )
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {width} {height}" width="1200" height="900"><title>平面方案图 · 坐标单位米</title>{"".join(nodes)}</svg>'


def plan_dxf(data):
    # Minimal ASCII R12 exchange format, millimetres. Layers distinguish object types.
    lines = []

    def emit(*pairs):
        for code, value in pairs:
            lines.extend([str(code), str(value)])

    emit(
        (0, "SECTION"),
        (2, "HEADER"),
        (9, "$ACADVER"),
        (1, "AC1009"),
        (9, "$INSUNITS"),
        (70, 4),
        (0, "ENDSEC"),
        (0, "SECTION"),
        (2, "ENTITIES"),
    )

    def line(layer, a, b):
        emit(
            (0, "LINE"),
            (8, layer),
            (10, round(a["x"] * 1000, 4)),
            (20, round(-a["y"] * 1000, 4)),
            (30, 0),
            (11, round(b["x"] * 1000, 4)),
            (21, round(-b["y"] * 1000, 4)),
            (31, 0),
        )

    for layer, a, b, _ in segments(data):
        line(layer, a, b)
    for layer, polygons in [
        ("ROOMS", [r["polygon"] for r in data["rooms"]]),
        ("FURNITURE", [furniture_polygon(i) for i in data.get("furniture", [])]),
    ]:
        for points in polygons:
            for a, b in zip(points, points[1:] + points[:1]):
                line(layer, a, b)
    emit((0, "ENDSEC"), (0, "EOF"))
    return "\r\n".join(lines) + "\r\n"
