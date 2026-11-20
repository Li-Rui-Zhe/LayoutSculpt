"""Compare observed wall spans with the candidate network in original image pixels."""

import math

import numpy as np
from PIL import Image
from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union

from .ai_contracts import apply_review_patch
from .architecture import opening_footprint, wall_footprint, wall_line


def _line_support(gray, segment, scale):
    """Compare a strip along the wall with its background on either side."""
    a, b = np.asarray(segment.coords)[[0, -1]]
    length = np.linalg.norm(b - a)
    direction = (b - a) / length
    normal = np.array([-direction[1], direction[0]])
    radius = max(2, min(20, math.ceil(0.13 / scale)))
    flank = max(radius * 2, min(140, math.ceil(0.42 / scale)))
    offsets = np.concatenate(([-flank - 1, -flank], np.arange(-radius, radius + 1), [flank, flank + 1]))
    centers = a + np.linspace(0.08, 0.92, min(160, max(12, round(length / 2))))[:, None] * (b - a)
    samples = np.rint(centers[:, None, :] + offsets[None, :, None] * normal).astype(int)
    x = samples[:, :, 0].clip(0, gray.shape[1] - 1)
    y = samples[:, :, 1].clip(0, gray.shape[0] - 1)
    strips = gray[y, x].astype(float)
    background = np.median(strips[:, abs(offsets) > radius], axis=1, keepdims=True)
    contrast = abs(strips[:, abs(offsets) <= radius] - background)
    # A thick stroke or a double-line wall should persist along the segment.
    if ((contrast >= 25).sum(axis=1) >= 2).mean() >= 0.65:
        return "clear"
    if (contrast.max(axis=1) >= 12).mean() >= 0.40:
        return "weak"
    return "blank"


def wall_findings(layout, evidence, alignment, *, source=None, check_extra=True):
    if not evidence.walls_px:
        return []
    ox, oy = alignment["origin_px"]
    scale = alignment["meters_per_pixel"]
    width, height = alignment["image_width"], alignment["image_height"]
    tolerance = max(2, min(math.hypot(width, height) * 0.006, 0.18 / scale))
    expected = [LineString([wall.a, wall.b]) for wall in evidence.walls_px if wall.a != wall.b]
    observed_gaps = [LineString([o.a, o.b]) for o in evidence.openings_px if o.certainty == "clear"]
    actual = unary_union(
        [
            LineString([(ox + w[end]["x"] / scale, oy + w[end]["y"] / scale) for end in ("start", "end")])
            for w in layout["walls"]
        ]
    )
    coverage = unary_union([actual, *observed_gaps]).buffer(tolerance, quad_segs=3)
    minimum_length = max(12, 3 * tolerance, 0.55 / scale)
    candidates = []
    for line in expected:
        missing = line.difference(coverage)
        for segment in getattr(missing, "geoms", [missing]):
            if segment.length >= minimum_length:
                candidates.append(segment)
    findings = []
    if candidates:
        gray = None
        if source is not None:
            with Image.open(source) as image:
                gray = np.asarray(image.convert("L"))
        # Collinear overlaps and duplicate observations must not multiply prompts.
        reported = []
        for segment in sorted(candidates, key=lambda line: -line.length):
            if any(previous.covers(segment) for previous in reported):
                continue
            support = _line_support(gray, segment, scale) if gray is not None else "unverified"
            if support == "blank":
                continue
            reported.append(segment.buffer(tolerance))
            x0, y0, x1, y1 = segment.bounds
            padding = max(6, 2 * tolerance)
            findings.append(
                {
                    "code": "missing_wall",
                    "blocking": support != "weak",
                    "support": support,
                    "span_px": [list(point) for point in segment.coords],
                    "message": "原图此处的墙线在当前结构中缺了一段，请核对是否漏墙。"
                    if support != "weak"
                    else "此处有较细的线迹，需结合原图区分隔墙与家具边线。",
                    "box": [
                        max(0, x0 - padding),
                        max(0, y0 - padding),
                        min(width, x1 + padding),
                        min(height, y1 + padding),
                    ],
                }
            )
    if check_extra and actual.length:
        supported = unary_union([*expected, *observed_gaps]).buffer(tolerance, quad_segs=3)
        if actual.difference(supported).length / actual.length > 0.2:
            findings.append(
                {
                    "code": "wall_position",
                    "blocking": True,
                    "message": "部分识别墙线偏离原图读到的墙线，请检查是否多画或错位。",
                }
            )
    return findings


def combine_wall_observations(first, second):
    """Keep distinct locations, including a weak line seen by both readers."""
    combined = [dict(f) for f in first if f["code"] == "missing_wall"]
    initial = list(combined)
    for finding in second:
        if finding["code"] != "missing_wall":
            continue
        segment = LineString(finding["span_px"])
        for original in initial:
            previous = LineString(original["span_px"])
            if segment.intersection(previous.buffer(4)).length >= 0.65 * max(segment.length, previous.length):
                original["blocking"] = True
                break
        else:
            combined.append(dict(finding))
    return combined


def apply_wall_detail(candidate, patch, findings, views, alignment):
    """Apply a sparse repair only within the disputed spans and their immediate surroundings."""
    if patch.outline or patch.scale_note or not patch.walls or patch.warnings:
        raise ValueError("局部读图未能确认漏墙，保留原结构待核对")
    proposed = apply_review_patch(candidate, patch)
    before, after = candidate.model_dump(), proposed.model_dump()
    ox, oy = alignment["origin_px"]
    scale = alignment["meters_per_pixel"]

    def meters(x, y):
        return (x - ox) * scale, (y - oy) * scale

    spans = unary_union([LineString([meters(*p) for p in f["span_px"]]) for f in findings])
    corridor = spans.buffer(max(0.22, 4 * scale))
    context = unary_union([box(*meters(*v["box"][:2]), *meters(*v["box"][2:])) for v in views])
    old_walls = {w["id"]: w for w in before["walls"]}
    new_walls = {w["id"]: w for w in after["walls"]}
    for change in patch.walls:
        if change.action == "delete":
            raise ValueError("漏墙修正不能删除已有墙体")
        line = wall_line(new_walls[change.id])
        if change.action == "update":
            original = old_walls[change.id]
            if any(
                new_walls[change.id][key] != original[key] for key in original if key not in {"start", "end"}
            ):
                raise ValueError("局部延长墙体时须保留原有墙体属性")
            old_line = wall_line(original)
            if not line.buffer(0.025).covers(old_line):
                raise ValueError("漏墙修正不能移走已识别墙线")
            line = line.difference(old_line.buffer(0.025))
        if not corridor.covers(line):
            raise ValueError("墙线修正超出原图疑点范围")
    # A wall extension can shift openings even if the patch omitted the openings field.
    for doc, walls, other, other_walls in (
        (before, old_walls, after, new_walls),
        (after, new_walls, before, old_walls),
    ):
        for opening in doc["openings"]:
            wall_id = opening["wall_id"]
            footprint = opening_footprint(walls[wall_id], opening)
            if not context.covers(footprint) and (
                opening not in other["openings"]
                or not footprint.equals_exact(opening_footprint(other_walls[wall_id], opening), 0.01)
            ):
                raise ValueError("局部修正影响了其他位置的洞口")

    def floor(room):
        return Polygon([(p["x"], p["y"]) for p in room["polygon"]]) if room else Polygon()

    old_rooms = {r["id"]: r for r in before["rooms"]}
    new_rooms = {r["id"]: r for r in after["rooms"]}
    for change in patch.rooms:
        old_room, new_room = old_rooms.get(change.id), new_rooms.get(change.id)
        changed_area = floor(old_room).symmetric_difference(floor(new_room))
        if (
            old_room
            and new_room
            and any(old_room[key] != new_room[key] for key in old_room if key != "polygon")
        ):
            changed_area = floor(old_room).union(floor(new_room))
        if not changed_area.difference(context).is_empty:
            raise ValueError("局部修正影响了疑点区域外的房间")
    changed_walls = unary_union([wall_footprint(new_walls[change.id]) for change in patch.walls])
    for room in new_rooms.values():
        pieces = floor(room).difference(changed_walls)
        if sum(part.area > 0.5 for part in getattr(pieces, "geoms", [pieces])) > 1:
            raise ValueError("补墙后原房间被分成两块，请核对房间边界")
    return proposed
