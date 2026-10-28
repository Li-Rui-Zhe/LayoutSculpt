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


def wall_finish_key(wall):
    return f"material:{wall['wall_material']}" if wall.get("wall_material") else wall.get("finish", "default")


GLASS_BOUNDARIES = {"glass_railing", "glazing"}
BOUNDARY_GLASS = "boundary_glass"


def section_finish(wall, elevation):
    if wall.get("boundary_type") in GLASS_BOUNDARIES and elevation >= wall.get("sill_height", 0):
        return BOUNDARY_GLASS
    return wall_finish_key(wall)


def balcony_walls(room, walls):
    """Match actual boundary overlap, not every wall near a balcony corner."""
    shape = Polygon([(p["x"], p["y"]) for p in room["polygon"]])
    return [w for w in walls if wall_line(w).intersection(
        shape.boundary.buffer(w["thickness"] / 2 + 0.12)
    ).length > max(0.2, wall_line(w).length * 0.5)]


def wall_sections(document, cut_height=1.2):
    """Continuous, nonoverlapping wall solids at every opening elevation.

    Openings are cut through the whole network so a joint cannot fill a door
    back in. Finish groups own disjoint footprints, including at their corners.
    """
    walls = document["walls"]
    by_id = {w["id"]: w for w in walls}
    footprints = {w["id"]: wall_footprint(w) for w in walls}
    levels = sorted({0, cut_height, *(w["height"] for w in walls),
                     *(w.get("sill_height", 0) for w in walls if w.get("boundary_type") in GLASS_BOUNDARIES),
                     *(o["bottom"] for o in document["openings"]),
                     *(o["bottom"] + o["height"] for o in document["openings"])})
    sections = []
    for bottom, top in zip(levels, levels[1:]):
        # 相同设计高度的浮点计算可能相差约 1e-16 米，不能挤出零厚度墙片。
        if top - bottom <= 1e-8:
            continue
        middle = (bottom + top) / 2
        voids = unary_union([
            opening_footprint(by_id[o["wall_id"]], o)
            for o in document["openings"]
            if o["bottom"] <= middle < o["bottom"] + o["height"]
        ])
        claimed = Polygon()
        finishes = sorted({section_finish(w, middle) for w in walls},
                          key=lambda finish: (finish == BOUNDARY_GLASS, finish == "default", finish))
        for finish in finishes:
            group = [w for w in walls if section_finish(w, middle) == finish
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
    balcony_findings = []
    for room in data["rooms"]:
        if room["kind"] != "balcony":
            continue
        boundary = balcony_walls(room, walls)
        if room.get("balcony_type", "unknown") == "unknown":
            balcony_findings.append(f"{room['name']} 的开放/封闭形式尚未确认，请核对外侧是实体栏板、玻璃栏板还是封窗，以及实际高度")
        if room.get("balcony_type") == "open":
            for wall in boundary:
                if not wall["exterior"] or wall["height"] < 1.8 or wall.get("boundary_type") == "glazing":
                    continue
                # A room divider can be exterior-labelled by recognition. Preserve
                # it and avoid treating it as the balcony's outer guard.
                if any(other["id"] != room["id"] and wall in balcony_walls(other, [wall]) for other in data["rooms"]):
                    continue
                balcony_findings.append(f"{room['name']} 外侧 {wall['id']} 高 {wall['height']:.2f} 米，请核对是否把栏板识别成层高实墙；侧面实墙按原图保留")
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
    return issues + balcony_findings


def validate_generated_structure(layout):
    # Layout already validates buildable geometry. Proximity and missing access
    # are ambiguous image findings, retained by structure_issues for review and
    # delivery warnings; they must not reject a user's confirmed wall network.
    return layout
