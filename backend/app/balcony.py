"""Frames for wall-aligned glass guards and enclosed balcony glazing."""

import math
from itertools import pairwise


def boundary_frame_parts(wall, openings=()):
    length = math.hypot(
        wall["end"]["x"] - wall["start"]["x"], wall["end"]["y"] - wall["start"]["y"]
    )
    bottom, top = wall.get("sill_height", 0), wall["height"]
    if wall.get("boundary_type") not in {"glass_railing", "glazing"}:
        return []
    bar = min(0.025, (top - bottom) / 4, length / 4)
    parts = []
    count = max(1, math.ceil(length / 1.2))
    offsets = sorted(
        {
            0,
            length,
            *(length * i / count for i in range(1, count)),
            *(o["offset"] for o in openings),
            *(o["offset"] + o["width"] for o in openings),
        }
    )
    for a, b in pairwise(offsets):
        for low, high in [(bottom, bottom + bar), (top - bar, top)]:
            if not any(
                o["offset"] < (a + b) / 2 < o["offset"] + o["width"]
                and o["bottom"] < high
                and o["bottom"] + o["height"] > low
                for o in openings
            ):
                parts.append((a, b, low, high))
    for offset in offsets:
        a, b = max(0, offset - bar / 2), min(length, offset + bar / 2)
        low = bottom
        for o in sorted(openings, key=lambda o: o["bottom"]):
            if o["offset"] + 1e-6 < offset < o["offset"] + o["width"] - 1e-6:
                if o["bottom"] > low:
                    parts.append((a, b, low, min(top, o["bottom"])))
                low = max(low, o["bottom"] + o["height"])
        if top > low:
            parts.append((a, b, low, top))
    return parts


def add_boundary_frames(builder):
    for wall in builder.document["walls"]:
        openings = [
            o for o in builder.document["openings"] if o["wall_id"] == wall["id"]
        ]
        a, b = wall["start"], wall["end"]
        dx, dz = b["x"] - a["x"], b["y"] - a["y"]
        length = math.hypot(dx, dz)
        builder.cut_metadata = {
            "wall_id": wall["id"],
            "boundary_type": wall.get("boundary_type", "wall"),
        }
        for start, end, low, high in boundary_frame_parts(wall, openings):
            offset = (start + end) / 2 / length
            builder.architectural_box(
                "阳台围护_细框",
                [
                    a["x"] + dx * offset - builder.cx,
                    (low + high) / 2,
                    a["y"] + dz * offset - builder.cz,
                ],
                [end - start, high - low, wall["thickness"] + 0.008],
                "metal",
                -math.atan2(dz, dx),
            )
    builder.cut_metadata = None
