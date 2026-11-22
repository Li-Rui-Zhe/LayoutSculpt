"""Find narrow exterior recesses supported by both the mask and the original ink."""

import numpy as np
from PIL import Image
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from .source_evidence import DetailRegion


def _runs(profile, missing):
    start = 0
    runs = []
    for end, depth in enumerate(profile):
        if abs(int(depth) - int(profile[start])) > 5:
            if end - start >= 8 and profile[start] != missing:
                runs.append((start, end, int(np.median(profile[start:end]))))
            start = end
    if len(profile) - start >= 8 and profile[start] != missing:
        runs.append((start, len(profile), int(np.median(profile[start:]))))
    return runs


def _supported_line(mask, ink, start, end, depth, *, vertical=False):
    if vertical:
        mask, ink = mask.T, ink.T
    margin = max(2, (end - start) // 8)
    span = slice(start + margin, end - margin)
    if end - start <= 2 * margin:
        return None
    offsets = range(max(0, depth - 6), min(mask.shape[0], depth + 7))
    # Raw ink must cover most of the span on the same line as the predicted wall.
    scores = [(float((ink[i, span] & (mask[i, span] == 1)).mean()), i) for i in offsets]
    peak = max((score for score, _ in scores), default=0)
    if peak < 0.68:
        return None
    return round(float(np.median([i for score, i in scores if score >= peak - 0.06])))


def _scan(mask, ink):
    height, width = mask.shape
    foreground = mask != 0
    first = np.where(foreground.any(axis=0), foreground.argmax(axis=0), height)
    profile = np.median(
        np.lib.stride_tricks.sliding_window_view(np.pad(first, 2, mode="edge"), 5),
        axis=1,
    )
    runs = _runs(profile, height)
    for left, center, right in zip(runs, runs[1:], runs[2:]):
        start, end, back = center
        if (
            left[1] + 5 < start
            or end + 5 < right[0]
            or end - start > width * 0.23
            or back - max(left[2], right[2]) < 10
            or back - min(left[2], right[2]) > height * 0.28
        ):
            continue
        back_wall = _supported_line(mask, ink, start, end, back)
        first_wall = _supported_line(mask, ink, left[2], back, start, vertical=True)
        second_wall = _supported_line(mask, ink, right[2], back, end, vertical=True)
        if back_wall is None or first_wall is None or second_wall is None:
            continue
        # Keep the empty strip above the back wall. Symbols and landscaping can
        # occur in it, but a solid crossing or a dense interior region cannot.
        mouth = max(left[2], right[2])
        void = ink[mouth + 3 : back - 3, start + 3 : end - 3]
        if not void.size or void.mean() > 0.18 or (void.mean(axis=1) > 0.6).any():
            continue
        yield [
            (first_wall, left[2]),
            (first_wall, back_wall),
            (second_wall, back_wall),
            (second_wall, right[2]),
        ]


def detect_outline_recesses(source, mask):
    height, width = mask.shape
    with Image.open(source) as image:
        size = image.size
        raw = np.asarray(
            image.convert("L").resize((width, height), Image.Resampling.BOX)
        )
    low, high = np.percentile(raw, [5, 90])
    if high - low < 42:
        return []
    ink = raw < min(185, low + (high - low) * 0.56)
    candidates = []
    for side in ("top", "bottom", "left", "right"):
        vertical = side in {"left", "right"}
        reverse = side in {"bottom", "right"}
        field, pixels = (mask.T, ink.T) if vertical else (mask, ink)
        if reverse:
            field, pixels = field[::-1], pixels[::-1]
        for path in _scan(field, pixels):
            points = []
            for along, depth in path:
                if reverse:
                    depth = field.shape[0] - 1 - depth
                x, y = (depth, along) if vertical else (along, depth)
                points.append(
                    [
                        round((x + 0.5) * size[0] / width, 1),
                        round((y + 0.5) * size[1] / height, 1),
                    ]
                )
            xs, ys = zip(*points)
            pad = max(12, min(size) * 0.022)
            candidates.append(
                {
                    "side": side,
                    "path_px": points,
                    "box": [
                        max(0, min(xs) - pad),
                        max(0, min(ys) - pad),
                        min(size[0], max(xs) + pad),
                        min(size[1], max(ys) + pad),
                    ],
                }
            )
    return candidates


def recess_findings(outline, candidates, *, walls=None, rooms=None):
    if not candidates:
        return []
    polygon = Polygon(outline)
    boundary = polygon.boundary
    findings = []
    for candidate in candidates:
        a, b, c, d = candidate["path_px"]
        back = LineString([b, c])
        tolerance = max(3, min(10, back.length * 0.18))
        vertical = candidate["side"] in {"left", "right"}
        direction = 1 if candidate["side"] in {"top", "left"} else -1
        center = back.interpolate(0.5, normalized=True)
        shoulder_depth = max(direction * p[0 if vertical else 1] for p in (a, d))
        back_depth = direction * (center.x if vertical else center.y)
        depth = direction * (shoulder_depth + back_depth) / 2
        outside = Point(depth, center.y) if vertical else Point(center.x, depth)
        corridors = [boundary.buffer(tolerance)]
        if walls is not None:
            corridors.append(walls.buffer(tolerance))
        segments = [LineString([a, b]), back, LineString([c, d])]
        supported = all(
            corridor.intersection(segment).length >= segment.length * 0.72
            for corridor in corridors
            for segment in segments
        )
        if (
            not polygon.covers(outside)
            and supported
            and (rooms is None or not rooms.covers(outside))
        ):
            continue
        findings.append(
            {
                "code": "outline_recess_mismatch",
                "message": "原图这一处有向外开口的三面凹口，请核对外轮廓、相邻房间和三段外墙。",
                "box": candidate["box"],
                "path_px": candidate["path_px"],
                "blocking": True,
            }
        )
    return findings


def layout_recess_findings(layout, alignment):
    candidates = alignment.get("local_segmentation", {}).get("outline_recesses", [])
    if not candidates:
        return []
    ox, oy = alignment["origin_px"]
    scale = alignment["meters_per_pixel"]

    def pixel(point):
        return [ox + point["x"] / scale, oy + point["y"] / scale]

    walls = unary_union(
        [
            LineString([pixel(wall["start"]), pixel(wall["end"])])
            for wall in layout["walls"]
            if wall["exterior"]
        ]
    )
    rooms = unary_union(
        [Polygon([pixel(p) for p in room["polygon"]]) for room in layout["rooms"]]
    )
    return recess_findings(
        [pixel(p) for p in layout["outline"]], candidates, walls=walls, rooms=rooms
    )


def trim_room_edge_spills(output, recesses, meters_per_pixel):
    """Trim slight room-edge overruns when the measured outline is preserved."""
    if output.input_check.status == "rejected" or not recesses or len(output.outline) < 3:
        return output
    outline = Polygon(output.outline)
    if (
        not outline.is_valid
        or outline.is_empty
        or recess_findings(output.outline, recesses)
    ):
        return output
    margin = outline.buffer(min(6.1, 0.16 / meters_per_pixel))
    rooms = []
    for room in output.rooms:
        shape = Polygon(room.polygon)
        trimmed = room
        if shape.is_valid and margin.covers(shape) and not outline.covers(shape):
            clipped = shape.intersection(outline)
            if (
                clipped.geom_type == "Polygon"
                and not clipped.is_empty
                and not clipped.interiors
                and shape.area - clipped.area <= shape.area * 0.005
                and len(clipped.exterior.coords) <= 25
            ):
                polygon = [list(p) for p in list(clipped.exterior.coords)[:-1]]
                trimmed = room.model_copy(update={"polygon": polygon})
        rooms.append(trimmed)
    return output.model_copy(update={"rooms": rooms})


def prioritize_recess_crops(regions, findings):
    if not findings:
        return regions
    focused = [DetailRegion(box=f["box"], reason=f["message"]) for f in findings[:3]]
    context = [
        region
        for region in regions
        if not any(
            all(abs(a - b) < 8 for a, b in zip(region.box, crop.box, strict=True))
            for crop in focused
        )
    ]
    return (focused + context)[:3]
