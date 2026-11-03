"""Advisory access checks. Never move furniture or block saving a design."""
import math

from shapely.geometry import Polygon
from shapely.ops import unary_union

from .opening_visuals import opening_parts
from .quality import footprint, solid_walls


def access_issues(plan, layout):
    items = [(i, item, footprint(item)) for i, item in enumerate(plan.items)
             if not item.edit_hidden and item.kind != "rug"]
    solids = solid_walls(layout)
    walls = {wall.id: wall for wall in layout.walls}
    issues = []

    def warn(code, text, type, index):
        issues.append({"code": code, "severity": "warning", "category": "access",
                       "text": text, "type": type, "index": index})

    for index, opening in enumerate(layout.openings):
        if opening.kind != "door" or not opening.door_leaf or opening.door_style == "sliding" or opening.edit_hidden:
            continue
        wall = walls[opening.wall_id]
        length = math.hypot(wall.end.x-wall.start.x, wall.end.y-wall.start.y)
        c, s = (wall.end.x-wall.start.x)/length, (wall.end.y-wall.start.y)/length
        shapes = []
        # Use the same leaf parts as the renderer, including hinge and double doors.
        for angle in range(0, math.ceil(max(90, opening.angle)) + 1, 5):
            data = {**opening.model_dump(), "angle": min(angle, max(90, opening.angle))}
            for part in opening_parts(data, wall.thickness):
                if part["name"] not in {"单开门扇", "双开门扇"}:
                    continue
                ca, sa = math.cos(part["angle"]), math.sin(part["angle"])
                points = []
                for x, z in [(-1,-1), (1,-1), (1,1), (-1,1)]:
                    x, z = x*part["size"][0]/2, z*part["size"][2]/2
                    u = opening.offset + part["position"][0] + ca*x + sa*z
                    v = part["position"][2] - sa*x + ca*z
                    points.append((wall.start.x+c*u-s*v, wall.start.y+s*u+c*v))
                shapes.append(Polygon(points))
        if shapes:
            sweep = unary_union(shapes).buffer(.025)
            blocked = [item.name or item.kind for _, item, shape in items
                       if item.elevation < opening.bottom+opening.height and item.elevation+item.height > opening.bottom
                       and sweep.intersection(shape).area > .012]
            if blocked:
                warn("door_swing", f"门 {index+1} 的开启范围可能碰到{'、'.join(blocked[:3])}，建议检查开门方向或家具位置", "openings", index)

    def zone(item, x0, y0, x1, y1):
        c, s = math.cos(math.radians(item.rotation)), math.sin(math.radians(item.rotation))
        return Polygon([(item.x+c*x-s*y, item.y+s*x+c*y) for x,y in [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]])

    def obstructed(area, index):
        obstacles = [solids, *[shape for i,item,shape in items if i != index and item.elevation < 1.8]]
        return any(area.intersection(shape).area > .025 for shape in obstacles)

    for index, item, _ in items:
        w, d = item.width/2, item.depth/2
        label = item.name or item.kind
        if item.kind in {"cabinet", "shoe_cabinet", "refrigerator", "washing_machine"}:
            area = zone(item, -w+.06, d+.03, w-.06, d+.6)
            if obstructed(area, index):
                warn("front_access", f"{label}正面约 60 cm 使用空间可能受挡，请检查开门、取物是否方便", "furniture", index)
        if item.kind == "bed":
            left = zone(item, -w-.55, -d+.35, -w-.03, d-.1)
            right = zone(item, w+.03, -d+.35, w+.55, d-.1)
            if obstructed(left, index) and obstructed(right, index):
                warn("bed_access", f"{label}两侧的上下床空间都比较紧，建议至少留出一侧约 55 cm", "furniture", index)
        if item.kind == "chair":
            # Chair fronts face +Y; the pull-out zone is behind the backrest.
            area = zone(item, -w+.04, -d-.5, w-.04, -d-.03)
            if obstructed(area, index):
                warn("chair_access", f"{label}后方拉椅空间可能不足，建议留出约 50 cm", "furniture", index)
    return issues
