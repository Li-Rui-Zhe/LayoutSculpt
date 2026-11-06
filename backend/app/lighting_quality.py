"""自动生成的有限任务照明，不改变已有灯具或人工编辑。"""
import math
from shapely.geometry import LineString, Point, Polygon

from .placement_geometry import walls_at_height
from .schemas import LightFixture


def add_task_lighting(layout, plan):
    changes = []
    for room in layout.rooms:
        if room.kind not in {"study", "kitchen"} or len(layout.lights) >= 12:
            continue
        polygon = Polygon([(p.x, p.y) for p in room.polygon])
        targets = [item for item in plan.items if item.room_id == room.id and not item.edit_hidden
                   and item.kind in ({"desk"} if room.kind == "study" else {"counter"})]
        if not targets:
            continue
        item = max(targets, key=lambda item: item.width * item.depth)
        # 工作面已有灯具（包括用户关闭的灯具）时不叠加；不堆叠多组补光。
        if any(math.hypot(light.x-item.x, light.y-item.y) < .8 for light in layout.lights):
            continue
        heights = [wall.height for wall in layout.walls if wall.height >= 2
                   and polygon.boundary.distance(LineString([(wall.start.x, wall.start.y), (wall.end.x, wall.end.y)])) < .2]
        elevation = min(heights, default=2.7) - .12
        point = Point(item.x, item.y)
        if item.elevation + item.height + .3 >= elevation or not polygon.buffer(-.1).covers(point):
            continue
        if walls_at_height(layout, elevation, elevation + .1).distance(point) < .1:
            continue
        count = 1
        identifier = f"task_{room.id[:25]}_{count}"
        while any(light.id == identifier for light in layout.lights):
            count += 1
            identifier = f"task_{room.id[:25]}_{count}"
        layout.lights.append(LightFixture(id=identifier, name=f"{room.name}工作区补光"[:60], kind="downlight",
                            x=item.x, y=item.y, elevation=elevation, temperature=4000, lumens=420))
        changes.append(f"为{room.name}的工作面补充一盏筒灯")
    return changes
