"""Geometric checks and conservative finishing for generated design proposals."""

import math

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from .schemas import LightFixture, validate_furnishing
from .architecture import structure_issues


def footprint(item):
    angle = math.radians(item.rotation)
    c, s = math.cos(angle), math.sin(angle)
    return Polygon(
        [
            (item.x + x * c - y * s, item.y + x * s + y * c)
            for x, y in [
                (-item.width / 2, -item.depth / 2),
                (item.width / 2, -item.depth / 2),
                (item.width / 2, item.depth / 2),
                (-item.width / 2, item.depth / 2),
            ]
        ]
    )


def solid_walls(layout):
    parts = []
    for wall in layout.walls:
        line = LineString([(wall.start.x, wall.start.y), (wall.end.x, wall.end.y)])
        openings = sorted(
            [
                o
                for o in layout.openings
                if o.wall_id == wall.id and o.kind in {"door", "passage"}
            ],
            key=lambda o: o.offset,
        )
        cursor = 0
        for start, end in [(o.offset, o.offset + o.width) for o in openings] + [
            (line.length, line.length)
        ]:
            if start > cursor:
                segment = LineString(
                    [line.interpolate(cursor), line.interpolate(start)]
                )
                parts.append(segment.buffer(wall.thickness / 2, cap_style=2))
            cursor = max(cursor, end)
    return unary_union(parts)


def door_clearances(layout):
    walls = {w.id: w for w in layout.walls}
    result = []
    for opening in layout.openings:
        if opening.kind not in {"door", "passage"}:
            continue
        wall = walls[opening.wall_id]
        line = LineString([(wall.start.x, wall.start.y), (wall.end.x, wall.end.y)])
        a = line.interpolate(opening.offset + 0.06)
        b = line.interpolate(opening.offset + opening.width - 0.06)
        if a.distance(b) > 0.05:
            result.append((wall.id, LineString([a, b]).buffer(0.45, cap_style=2)))
    return result


def furnishing_issues(plan, layout):
    """Return specific repair feedback, allowing intentional rugs and tucked chairs."""
    issues = []
    solids, doors = solid_walls(layout), door_clearances(layout)
    footprints = [footprint(item) for item in plan.items]
    for i, (item, shape) in enumerate(zip(plan.items, footprints)):
        label = item.name or f"{item.room_id}/{item.kind}"
        if item.kind != "rug" and shape.intersection(solids).area > 0.012:
            issues.append(f"{label} 与实体墙体相交，请移动到室内净空区域")
        if item.kind != "rug":
            for wall_id, door in doors:
                if shape.intersection(door).area > 0.035:
                    issues.append(
                        f"{label} 阻挡 {wall_id} 门口，请留出至少 0.45 米通行区"
                    )
        for other, other_shape in zip(plan.items[:i], footprints[:i]):
            if "rug" in {item.kind, other.kind}:
                continue
            # Chairs may tuck partially under a table, but not disappear into it.
            overlap = shape.intersection(other_shape).area
            allowed = (
                0.35
                if {item.kind, other.kind} <= {"chair", "table", "desk"}
                and item.kind != other.kind
                else 0.06
            )
            if overlap > max(0.012, min(shape.area, other_shape.area) * allowed):
                issues.append(f"{label} 与 {other.name or other.kind} 重叠，请调整位置")
        if item.kind == "bed" and (
            item.width < 0.85 or item.depth < 1.8 or item.height < 0.55
        ):
            issues.append(
                f"{label} 尺寸不符合床的基本使用要求（宽 ≥ 0.85、长 ≥ 1.8 米）"
            )
        if item.kind == "chair" and not 0.65 <= item.height <= 1.2:
            issues.append(f"{label} 高度不合理，请使用正常座椅尺寸")
    return list(dict.fromkeys(issues))


def validate_generated_furnishing(plan, layout):
    from .schemas import validate_furnishing

    validate_furnishing(plan, layout)
    issues = furnishing_issues(plan, layout)
    if issues:
        raise ValueError("；".join(issues[:12]))
    return plan


def prepare_generated_furnishing(plan, layout):
    """Fit generated furniture locally without changing any confirmed structure.

    This is deliberately not used for manual edits. Missing space omits only the
    affected item with a visible note, rather than failing the entire house.
    """
    result = plan.model_copy(deep=True)
    rooms = {room.id: room for room in layout.rooms}
    shapes = {key: Polygon([(p.x, p.y) for p in room.polygon]).buffer(1e-6)
              for key, room in rooms.items()}
    solids, doors = solid_walls(layout), door_clearances(layout)
    accepted = []
    fitted = {}
    notes = []

    def usable(item):
        shape = footprint(item)
        if item.room_id not in shapes or not shapes[item.room_id].covers(shape):
            return False
        if not (-60 <= item.x <= 60 and -60 <= item.y <= 60):
            return False
        if item.kind != "rug":
            if shape.intersection(solids).area > 0.012:
                return False
            if any(shape.intersection(door).area > 0.035 for _, door in doors):
                return False
        for other, other_shape in accepted:
            if "rug" in {item.kind, other.kind}:
                continue
            allowed = (0.35 if {item.kind, other.kind} <= {"chair", "table", "desk"}
                       and item.kind != other.kind else 0.06)
            if shape.intersection(other_shape).area > max(0.012, min(shape.area, other_shape.area) * allowed):
                return False
        return True

    # Preserve major furniture before trying to place chairs and decorations.
    priority = {kind: index for index, kind in enumerate([
        "counter", "bed", "sofa", "cabinet", "shower", "bathtub", "toilet",
        "sink", "refrigerator", "table", "desk", "chair", "plant", "rug",
    ])}
    offsets = [(0, 0)]
    for distance in (0.025, 0.05, 0.1, 0.15, 0.2, 0.25):
        offsets.extend((dx * distance, dy * distance)
                       for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        offsets.extend((dx * distance / math.sqrt(2), dy * distance / math.sqrt(2))
                       for dx, dy in ((1, 1), (1, -1), (-1, 1), (-1, -1)))
    for index, original in sorted(enumerate(result.items), key=lambda pair: priority[pair[1].kind]):
        item = original.model_copy(deep=True)
        label = item.name or item.kind
        if item.room_id not in rooms or not shapes[item.room_id].covers(Point(item.x, item.y)):
            room_id = next((key for key, shape in shapes.items() if shape.covers(Point(item.x, item.y))), None)
            if room_id and room_id != item.room_id:
                item.room_id = room_id
                notes.append(f"已将{label}归属到{rooms[room_id].name}，保留原位置")
        placed = None
        for scale in (1, 0.95, 0.9):
            if min(item.width * scale, item.depth * scale) < 0.1:
                continue
            for dx, dy in offsets:
                candidate = item.model_copy(update={
                    "x": round(item.x + dx, 6) if dx else item.x,
                    "y": round(item.y + dy, 6) if dy else item.y,
                    "width": item.width * scale, "depth": item.depth * scale,
                })
                if usable(candidate):
                    placed = candidate
                    break
            if placed:
                break
        if placed:
            fitted[index] = placed
            accepted.append((placed, footprint(placed)))
            if placed.model_dump() != item.model_dump():
                notes.append(f"已微调{label}的位置或尺寸，避让墙体、门口及相邻家具（平移不超过 0.25 米，缩小不超过 10%）")
        else:
            notes.append(f"暂未放置{label}：局部空间不足，已保留完整户型，可在手动调整中补充")
    result.items = [fitted[index] for index in sorted(fitted)]
    validate_furnishing(result, layout)
    # Unusual furniture dimensions are advice, not a reason to discard a house.
    advice = furnishing_issues(result, layout)
    combined = list(dict.fromkeys([*notes, *advice, *result.notes]))
    result.notes = combined if len(combined) <= 20 else [*combined[:19], f"另有 {len(combined) - 19} 条家具调整记录，请检查家具布置"]
    return result


def finish_design(layout, plan, *, automatic=True):
    """Add editable lighting and face chairs toward nearby tables; preserve manual work."""
    layout, plan = layout.model_copy(deep=True), plan.model_copy(deep=True)
    changes = []
    if automatic:
        walls = solid_walls(layout)
        for item in plan.items:
            if item.kind != "counter" or item.depth <= 0.8 or item.width >= 0.8:
                continue
            # Some plans encode an east/west cabinet as an excessively deep north/
            # south cabinet. Swap its local axes without changing its footprint.
            candidates = [
                (item.rotation + delta + 180) % 360 - 180 for delta in [-90, 90]
            ]

            def back_distance(angle):
                a = math.radians(angle)
                return Point(
                    item.x + math.sin(a) * item.width / 2,
                    item.y - math.cos(a) * item.width / 2,
                ).distance(walls)

            item.rotation = min(candidates, key=back_distance)
            item.width, item.depth = item.depth, item.width
            changes.append(
                f"{item.name or '厨房地柜'} 校正局部宽深与柜门朝向，保留占地"
            )
        for chair in (item for item in plan.items if item.kind == "chair"):
            tables = [
                item
                for item in plan.items
                if item.room_id == chair.room_id
                and item.kind in {"table", "desk"}
                and item.height >= 0.65
            ]
            if not tables:
                continue
            table = min(
                tables, key=lambda item: math.hypot(item.x - chair.x, item.y - chair.y)
            )
            if math.hypot(table.x - chair.x, table.y - chair.y) > 2:
                continue
            # Face the nearest table edge rather than fanning every chair toward
            # the table's centre. The table itself may be rotated.
            a = math.radians(table.rotation)
            c, s = math.cos(a), math.sin(a)
            dx, dy = chair.x - table.x, chair.y - table.y
            lx, ly = dx * c + dy * s, -dx * s + dy * c
            fx, fy = (
                (-math.copysign(1, lx), 0)
                if abs(lx) / table.width > abs(ly) / table.depth
                else (0, -math.copysign(1, ly))
            )
            angle = math.degrees(math.atan2(-(fx * c - fy * s), fx * s + fy * c))
            candidate = chair.model_copy(update={"rotation": round(angle, 2)})
            room = next(r for r in layout.rooms if r.id == chair.room_id)
            if (
                not Polygon([(p.x, p.y) for p in room.polygon])
                .buffer(1e-6)
                .covers(footprint(candidate))
            ):
                continue
            original = chair.rotation
            previous_issues = set(furnishing_issues(plan, layout))
            chair.rotation = candidate.rotation
            if set(furnishing_issues(plan, layout)) - previous_issues:
                chair.rotation = original
            elif abs(original - chair.rotation) > 1:
                changes.append(f"{chair.name or '餐椅'} 朝向桌面")
        for room in layout.rooms:
            polygon = Polygon([(p.x, p.y) for p in room.polygon])
            if len(layout.lights) >= 12 or any(
                polygon.covers(Point(l.x, l.y)) for l in layout.lights
            ):
                continue
            if room.kind in {"other", "balcony"} or polygon.area < 1:
                continue
            # A centroid can lie outside a concave room. Choose a valid interior point.
            point = polygon.centroid
            if not polygon.buffer(-0.15).covers(point):
                point = polygon.representative_point()
            ceiling = min((w.height for w in layout.walls), default=2.7)
            used = {light.id for light in layout.lights}
            identifier = f"auto_{len(layout.lights) + 1}"
            while identifier in used:
                identifier += "_"
            layout.lights.append(
                LightFixture(
                    id=identifier,
                    name=f"{room.name}主灯",
                    kind="pendant",
                    x=round(point.x, 3),
                    y=round(point.y, 3),
                    elevation=max(0.5, ceiling - 0.35),
                    lumens=min(2400, max(500, round(polygon.area * 160))),
                    temperature=4000
                    if room.kind in {"kitchen", "bathroom", "study"}
                    else 3000,
                )
            )
            changes.append(f"为{room.name}配置可编辑主灯")
    report = {
        "version": 1,
        "changes": changes,
        "issues": furnishing_issues(plan, layout) + structure_issues(layout),
        "room_count": len(layout.rooms),
        "wall_count": len(layout.walls),
        "opening_count": len(layout.openings),
        "furniture_count": len(plan.items),
        "light_count": len(layout.lights),
        "scale_note": layout.scale_note,
    }
    return layout, plan, report
