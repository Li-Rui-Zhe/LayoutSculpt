"""淋浴湿区适配检查；平面后方 -Y 为花洒安装面，前方 +Y 为入口。"""
import math

from shapely.geometry import LineString, Point, Polygon

SHOWER_KINDS = {"shower", "shower_walk_in", "shower_open"}


def local_point(item, x, y):
    angle = math.radians(item.rotation)
    c, s = math.cos(angle), math.sin(angle)
    return (item.x + x * c - y * s, item.y + x * s + y * c)


def entrance(item):
    half = min(.35, item.width * .4)
    return Polygon([local_point(item, x, y) for x, y in [
        (-half, item.depth / 2), (half, item.depth / 2),
        (half, item.depth / 2 + .55), (-half, item.depth / 2 + .55),
    ]])


def placement_issues(item, layout):
    if item.kind not in SHOWER_KINDS:
        return []
    label = item.name or "淋浴区"
    issues = []
    if min(item.width, item.depth) < .8 or item.height < 1.8:
        issues.append(f"{label} 过小：湿区宽深至少 0.8 米、花洒高度至少 1.8 米")
    if item.elevation > .15:
        issues.append(f"{label} 离地过高，请落地布置并衔接排水")
    # Integrated showers borrow an existing wall. Check the entire fitting width,
    # not just its centre; a pipe must not straddle a window or a doorway.
    mounting = LineString([local_point(item, x, -item.depth / 2) for x in [-.22, .22]])
    candidates = []
    for wall in layout.walls:
        line = LineString([(wall.start.x, wall.start.y), (wall.end.x, wall.end.y)])
        zone = line.buffer(wall.thickness / 2 + .18, cap_style=2)
        if zone.covers(mounting) and wall.height >= item.elevation + item.height - .05:
            candidates.append((wall, line))
    if item.kind != "shower":
        supported = False
        for wall, line in candidates:
            low, high = sorted(line.project(Point(coord)) for coord in mounting.coords)
            blocked = any(o.wall_id == wall.id
                          and min(high, o.offset + o.width) > max(low, o.offset) + .001
                          and min(item.elevation + item.height, o.bottom + o.height) > max(item.elevation + .8, o.bottom)
                          for o in layout.openings)
            if not blocked:
                supported = True
                break
        if not supported:
            issues.append(f"{label} 花洒后方需要完整实墙，请旋转或移动，避开门窗与通道")
    # Only opaque enclosure panels block light. Integrated types have no back or
    # right panel; their left glass is intentionally transparent beside a window.
    if item.kind == "shower":
        panels = [LineString([local_point(item, *p) for p in points]) for points in [
            [(-item.width / 2, -item.depth / 2), (item.width / 2, -item.depth / 2)],
            [(item.width / 2, -item.depth / 2), (item.width / 2, item.depth / 2)],
        ]]
        walls = {w.id: w for w in layout.walls}
        for opening in layout.openings:
            if opening.kind != "window":
                continue
            if min(item.elevation + item.height, opening.bottom + opening.height) <= max(item.elevation, opening.bottom):
                continue
            wall = walls[opening.wall_id]
            line = LineString([(wall.start.x, wall.start.y), (wall.end.x, wall.end.y)])
            window = LineString([line.interpolate(opening.offset), line.interpolate(opening.offset + opening.width)])
            if any(panel.intersection(window.buffer(wall.thickness / 2 + .2, cap_style=2)).length > .08 for panel in panels):
                issues.append(f"{label} 的实体背板遮挡窗户，请移位或改用步入式 / 开放式淋浴区")
                break
    return issues
