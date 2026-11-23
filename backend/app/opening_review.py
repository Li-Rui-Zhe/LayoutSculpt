"""Use local pixel evidence to choose original-resolution opening crops."""

from collections import Counter, deque
from math import dist

import numpy as np
from shapely.geometry import LineString, Polygon, box

from .floorplan_inference import classify_span
from .source_evidence import DetailRegion

NAMES = {"wall": "墙体", "window": "窗", "door": "门", "passage": "通道"}


def opening_box(a, b, image_size, padding=None):
    margin = padding if padding is not None else max(24, dist(a, b) * 0.38)
    return [
        max(0, min(a[0], b[0]) - margin),
        max(0, min(a[1], b[1]) - margin),
        min(image_size[0], max(a[0], b[0]) + margin),
        min(image_size[1], max(a[1], b[1]) + margin),
    ]


def opening_blobs(mask, image_size):
    """Collect coherent door/window regions in source-image coordinates."""
    height, width = mask.shape
    remaining = np.where(mask >= 2, mask, 0)
    pending = deque()
    pixels = np.argwhere(remaining)
    blobs = []
    for y, x in pixels.tolist():
        kind = remaining[y, x]
        if not kind:
            continue
        pending.append((y, x))
        remaining[y, x] = 0
        left = right = x
        top = bottom = y
        area = 0
        while pending:
            row, col = pending.popleft()
            area += 1
            left, right = min(left, col), max(right, col)
            top, bottom = min(top, row), max(bottom, row)
            for v, u in [
                (row - 1, col),
                (row + 1, col),
                (row, col - 1),
                (row, col + 1),
            ]:
                if 0 <= v < height and 0 <= u < width and remaining[v, u] == kind:
                    remaining[v, u] = 0
                    pending.append((v, u))
        across, down = right + 1 - left, bottom + 1 - top
        if area < 18 or min(across, down) < 2 or max(across, down) < 8:
            continue
        bounds = [
            left * image_size[0] / width,
            top * image_size[1] / height,
            (right + 1) * image_size[0] / width,
            (bottom + 1) * image_size[1] / height,
        ]
        blobs.append((area, "window" if kind == 2 else "door", box(*bounds)))
    return sorted(blobs, key=lambda item: -item[0])[:40]


def plan_opening_review(evidence, mask, image_size):
    """Keep the primary reader's context and spend up to two crops on local doubts."""
    matches = 0
    uncertain = 0
    candidates = []
    cloud_spans = []
    disputed_types = set()
    for index, observed in enumerate(evidence.openings_px):
        segment = LineString([observed.a, observed.b])
        cloud_spans.append(segment)
        signal = classify_span(mask, observed.a, observed.b, image_size)
        if signal is None:
            uncertain += 1
        elif signal == observed.kind:
            matches += 1
        elif observed.kind != "passage" or signal != "wall":
            if observed.kind != "passage":
                disputed_types.add(index)
            candidates.append(
                {
                    "decision": "conflict",
                    "box": opening_box(observed.a, observed.b, image_size),
                    "cloud": observed.kind,
                    "local": signal,
                }
            )

    # A blank mask cannot tell us a door is missing. A coherent positive detection
    # near a wall, away from every reported opening, can give us a region to inspect.
    outline = Polygon(evidence.outline_px).buffer(6)
    walls = [LineString([wall.a, wall.b]) for wall in evidence.walls_px]
    if walls:
        for _, kind, bounds in opening_blobs(mask, image_size):
            a, b, c, d = bounds.bounds
            gap = max(6, min(18, min(c - a, d - b) * 0.6))
            center = bounds.centroid
            if (
                not outline.covers(center)
                or min(w.distance(center) for w in walls) > gap
            ):
                continue
            if any(span.distance(bounds) <= gap for span in cloud_spans):
                continue
            candidates.append(
                {
                    "decision": "possible_missing",
                    "box": opening_box((a, b), (c, d), image_size),
                    "local": kind,
                }
            )

    regions = list(evidence.regions)
    occupied = []
    for region in regions:
        a, b, c, d = region.box
        dx, dy = (c - a) * 0.15, (d - b) * 0.15
        occupied.append(box(a - dx, b - dy, c + dx, d + dy))
    chosen = []
    new_crops = 0
    missing = [item for item in candidates if item["decision"] == "possible_missing"]
    conflicts = [item for item in candidates if item["decision"] == "conflict"]
    for candidate in [*missing, *conflicts]:
        extent = box(*candidate["box"])
        if any(
            extent.intersection(box(*item["box"])).area >= extent.area * 0.6
            for item in chosen
        ):
            continue
        covered = any(
            extent.intersection(view).area >= extent.area * 0.6 for view in occupied
        )
        if not covered:
            if len(regions) == 3 or new_crops == 2:
                continue
            regions.append(
                DetailRegion(
                    box=candidate["box"],
                    reason="核对这一区域的墙体与开口，保留墙端和相邻空间作为参照。",
                )
            )
            occupied.append(extent)
            new_crops += 1
        chosen.append(candidate)
        if len(chosen) == 3:
            break

    summaries = {
        "agreement_count": matches,
        "uncertain_count": uncertain,
        "conflict_count": len(conflicts),
        "possible_missing_count": len(missing),
        "selected_count": len(chosen),
        "new_crop_count": new_crops,
        "candidates": chosen,
    }
    return regions, summaries, disputed_types


def cloud_opening_context(summary):
    return [
        {
            "box": candidate["box"],
            "hypothesis": f"本地像素支持{NAMES[candidate['local']]}",
            "first_read": NAMES[candidate["cloud"]]
            if "cloud" in candidate
            else "此处未定位洞口",
        }
        for candidate in summary["candidates"]
    ]


def outline_pixel_context(evidence, mask, image_size):
    """Flag an outer-edge disagreement only if several scanlines support it."""
    outline = Polygon(evidence.outline_px)
    height, width = mask.shape
    reported = {}
    for direction, field, along, across in (
        ("horizontal", mask, image_size[1] / height, image_size[0] / width),
        ("vertical", mask.T, image_size[0] / width, image_size[1] / height),
    ):
        across_pixels = field.shape[1] * across
        limits = np.flatnonzero((field > 0).sum(axis=1) >= 6)
        if len(limits) < 20:
            continue
        lines = []
        for index in np.linspace(limits[0], limits[-1], 13)[1:-1].round().astype(int):
            axis = round(float(index * along))
            band = field[max(0, index - 2) : index + 3] > 0
            stable = np.flatnonzero(band.sum(axis=0) >= 3)
            if len(stable) < 6:
                continue
            available = [
                round(float(stable[0] * across)),
                round(float((stable[-1] + 1) * across)),
            ]
            scan = (
                [(0, axis), (across_pixels, axis)]
                if direction == "horizontal"
                else [(axis, 0), (axis, across_pixels)]
            )
            section = outline.intersection(LineString(scan))
            if section.is_empty:
                if available[1] - available[0] >= across_pixels * 0.07:
                    lines.append({"position_px": axis, "local_bounds_px": available})
                continue
            bounds = section.bounds
            reported_bounds = bounds[::2] if direction == "horizontal" else bounds[1::2]
            mismatch = max(
                abs(a - b) for a, b in zip(reported_bounds, available, strict=True)
            )
            if mismatch >= max(12, across_pixels * 0.06):
                lines.append(
                    {
                        "position_px": axis,
                        "local_bounds_px": available,
                        "initial_bounds_px": [round(x) for x in reported_bounds],
                    }
                )
        if len(lines) >= 2:
            reported[direction] = lines[:5]
    return reported


def needs_manual_structure_review(comparison, local_findings):
    """Avoid one small patch when both the frame and several structural regions disagree."""
    blocking = Counter(f["code"] for f in comparison["findings"] if f["blocking"])
    return (
        comparison["outline_overlap"] < 0.90
        and blocking["opening_mismatch"] >= 3
        and blocking["missing_wall"] >= 2
        and bool(blocking["wall_position"])
        and not local_findings
    )


def mask_aperture_context(mask, image_size):
    """Describe bounded pixel regions directly, including candidates far from a bad draft."""
    blobs = opening_blobs(mask, image_size)
    spans = []
    for label in ("door", "window"):
        for _, kind, shape in [blob for blob in blobs if blob[1] == label][:12]:
            spans.append(
                {
                    "kind": kind,
                    "box": [round(value, 1) for value in shape.bounds],
                }
            )
    return spans
