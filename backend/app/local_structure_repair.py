"""Constrain a second structure pass to places that can be checked in the source."""

from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from .ai_contracts import apply_review_patch
from .architecture import opening_footprint, rooms_with_open_access, wall_footprint


def needs_fresh_read(comparison):
    # Fixing a few crops is unlikely to recover a draft with both a weak
    # outline match and opening disagreements spread across the plan.
    return (
        comparison["outline_overlap"] < 0.85
        and sum(
            f["code"] == "opening_mismatch" and f["blocking"]
            for f in comparison["findings"]
        )
        >= 6
    )


def outline_regions(layout, evidence, alignment):
    scale = alignment["meters_per_pixel"]
    ox, oy = alignment["origin_px"]
    actual = Polygon(
        [(ox + p["x"] / scale, oy + p["y"] / scale) for p in layout["outline"]]
    )
    expected = Polygon(evidence.outline_px)
    # Missing wings can be read separately from the rest of the outline.
    missing = expected.difference(actual.buffer(4))
    return [
        {
            "code": "outline_mismatch",
            "box": list(piece.bounds),
            "blocking": True,
            "message": "外轮廓局部与原图有分歧，请核对凸出空间及其外墙、房间和出入口。",
        }
        for piece in sorted(
            getattr(missing, "geoms", [missing]), key=lambda part: -part.area
        )
        if piece.area >= 600 and piece.area < actual.area * 0.18
    ][:1]


def same_place(first, second):
    if first["code"] != second["code"]:
        return False
    if first.get("wall_id") and second.get("wall_id"):
        return first["wall_id"] == second["wall_id"]
    if first.get("box") and second.get("box"):
        a, b = box(*first["box"]), box(*second["box"])
        return a.intersection(b).area >= 0.55 * min(a.area, b.area)
    return True


def choose_repair_regions(primary, audit, pixel, outline):
    openings = [
        f
        for f in [*audit, *primary]
        if f["code"] == "opening_mismatch" and f.get("box")
    ]
    openings.sort(
        key=lambda finding: (
            not (
                any(same_place(finding, other) for other in primary)
                and any(same_place(finding, other) for other in audit)
            )
        )
    )
    weak_walls = [f for f in pixel if f["blocking"] and f.get("box")]
    targets = []
    for finding in [*outline, *openings[:1], *weak_walls, *openings[1:]]:
        region = box(*finding["box"])
        if not region.area or any(
            region.intersection(old).area > 0.65 * region.area for _, old in targets
        ):
            continue
        targets.append((finding, region))
        if len(targets) == 3:
            break
    return [finding for finding, _ in targets]


def apply_local_structure(candidate, patch, views, alignment):
    if patch.scale_note or not (
        patch.walls or patch.openings or patch.rooms or patch.outline
    ):
        raise ValueError("局部复核未提交可验证的结构修正")
    proposed = apply_review_patch(candidate, patch)
    before, after = candidate.model_dump(), proposed.model_dump()
    validate_repair_extent(before, after, views, alignment)
    validate_access(before, after)
    return proposed


def validate_access(before, after):
    old_access = rooms_with_open_access(before)
    surviving_ids = {room["id"] for room in after["rooms"]}
    if (old_access & surviving_ids) - rooms_with_open_access(after):
        raise ValueError("修正造成已有房间失去通行路径")


def validate_repair_extent(before, after, views, alignment):
    scale = alignment["meters_per_pixel"]
    ox, oy = alignment["origin_px"]
    context = unary_union(
        [
            box(
                (x1 - ox) * scale,
                (y1 - oy) * scale,
                (x2 - ox) * scale,
                (y2 - oy) * scale,
            )
            for view in views
            for x1, y1, x2, y2 in [view["box"]]
        ]
    )

    def polygon(points):
        return Polygon([(point["x"], point["y"]) for point in points])

    def check(change):
        if change.difference(context).area > 0.0001:
            raise ValueError("结构补丁影响了原图局部取景范围以外的内容")

    check(polygon(before["outline"]).symmetric_difference(polygon(after["outline"])))
    for key, geometry, shape_keys in (
        ("walls", wall_footprint, {"start", "end", "thickness"}),
        ("rooms", lambda r: polygon(r["polygon"]), {"polygon"}),
    ):
        previous = {entry["id"]: entry for entry in before[key]}
        current = {entry["id"]: entry for entry in after[key]}
        for identifier in previous.keys() | current.keys():
            a, b = previous.get(identifier), current.get(identifier)
            if a == b:
                continue
            old_shape = geometry(a) if a else Polygon()
            new_shape = geometry(b) if b else Polygon()
            metadata_changed = (
                a and b and any(a[k] != b[k] for k in a.keys() - shape_keys)
            )
            check(
                old_shape.union(new_shape)
                if metadata_changed
                else old_shape.symmetric_difference(new_shape)
            )

    def openings(document):
        walls = {wall["id"]: wall for wall in document["walls"]}
        return [
            (opening, opening_footprint(walls[opening["wall_id"]], opening))
            for opening in document["openings"]
        ]

    a, b = openings(before), openings(after)
    for current, other in ((a, b), (b, a)):
        for opening, shape in current:
            if not any(
                opening == old and shape.equals_exact(previous, 0.01)
                for old, previous in other
            ):
                check(shape)
