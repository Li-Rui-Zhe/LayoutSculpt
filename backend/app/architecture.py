"""Wall footprints and height sections shared by modeling and structure checks."""

import math

from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union


def wall_line(wall):
    return LineString([(wall["start"]["x"], wall["start"]["y"]),
                       (wall["end"]["x"], wall["end"]["y"])])


def wall_footprint(wall):
    # Square ends meet at L/T junctions. Union removes the overlapping corner
    # faces, unlike exporting a separate rectangular box for each wall.
    return wall_line(wall).buffer(wall["thickness"] / 2, cap_style=3, join_style=2)


def opening_footprint(wall, opening):
    line = wall_line(wall)
    return LineString([line.interpolate(opening["offset"]),
                       line.interpolate(opening["offset"] + opening["width"])]).buffer(
        wall["thickness"] / 2 + 0.001, cap_style=2
    )


def wall_sections(document, cut_height=1.2):
    """Continuous, nonoverlapping wall solids at every opening elevation.

    Openings are cut through the whole network so a joint cannot fill a door
    back in. Finish groups own disjoint footprints, including at their corners.
    """
    walls = document["walls"]
    by_id = {w["id"]: w for w in walls}
    footprints = {w["id"]: wall_footprint(w) for w in walls}
    levels = sorted({0, cut_height, *(w["height"] for w in walls),
                     *(o["bottom"] for o in document["openings"]),
                     *(o["bottom"] + o["height"] for o in document["openings"])})
    sections = []
    for bottom, top in zip(levels, levels[1:]):
        middle = (bottom + top) / 2
        voids = unary_union([
            opening_footprint(by_id[o["wall_id"]], o)
            for o in document["openings"]
            if o["bottom"] <= middle < o["bottom"] + o["height"]
        ])
        claimed = Polygon()
        finishes = sorted({w.get("finish", "default") for w in walls},
                          key=lambda finish: (finish == "default", finish))
        for finish in finishes:
            group = [w for w in walls if w.get("finish", "default") == finish
                     and w["height"] > middle]
            shape = unary_union([footprints[w["id"]] for w in group]).difference(voids)
            shape = shape.difference(claimed)
            claimed = claimed.union(shape)
            if not shape.is_empty and shape.area > 1e-8:
                sections.append((bottom, top, finish, shape))
    return sections


def structure_issues(layout, *, include_access=True):
    """Conservative feedback; proximity alone never deletes a real partition."""
    data = layout.model_dump()
    walls = data["walls"]
    issues = []
    for i, wall in enumerate(walls):
        line = wall_line(wall)
        a, b = line.coords
        dx, dy = (b[0] - a[0]) / line.length, (b[1] - a[1]) / line.length
        for other in walls[:i]:
            previous = wall_line(other)
            c, d = previous.coords
            ox, oy = (d[0] - c[0]) / previous.length, (d[1] - c[1]) / previous.length
            if abs(dx * oy - dy * ox) > math.sin(math.radians(2)):
                continue
            separation = line.distance(previous)
            half_widths = (wall["thickness"] + other["thickness"]) / 2
            positions = sorted(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy for p in [c, d]))
            overlap = min(line.length, positions[1]) - max(0, positions[0])
            # A centimetre sliver between almost touching parallel walls is
            # typically a duplicated shared boundary, not a usable corridor.
            if 0.01 < separation < half_widths + 0.06 and overlap > 0.6:
                gap = max(0, separation - half_widths)
                issues.append(f"墙体 {wall['id']} 与 {other['id']} 平行重叠 {overlap:.2f} 米，"
                              f"净间距仅 {gap:.2f} 米；请对照原图确认共享墙是否重复识别")
    if include_access:
        openings = [opening_footprint(wall, opening).buffer(0.22)
                    for opening in data["openings"]
                    if opening["kind"] in {"door", "passage"}
                    for wall in walls if wall["id"] == opening["wall_id"]]
        for room in data["rooms"]:
            if room["kind"] not in {"bedroom", "bathroom", "kitchen", "balcony"}:
                continue
            shape = Polygon([(point["x"], point["y"]) for point in room["polygon"]])
            if not any(shape.intersection(door).area > 0.01 for door in openings):
                issues.append(f"{room['name']} 未识别到门或通道，请对照原图确认出入口")
    return issues


def validate_generated_structure(layout):
    # Layout already validates buildable geometry. Proximity and missing access
    # are ambiguous image findings, retained by structure_issues for review and
    # delivery warnings; they must not reject a user's confirmed wall network.
    return layout
