"""Height-aware occupied wall strips, shared by validation and advice."""

from shapely.geometry import LineString
from shapely.ops import unary_union


def walls_at_height(layout, bottom, top):
    parts = []
    for wall in layout.walls:
        if wall.edit_hidden or bottom >= wall.height or top <= 0:
            continue
        line = LineString([(wall.start.x, wall.start.y), (wall.end.x, wall.end.y)])
        openings = [
            o for o in layout.openings if o.wall_id == wall.id and not o.edit_hidden
        ]
        cuts = sorted(
            {
                0,
                line.length,
                *[
                    max(0, min(line.length, x))
                    for o in openings
                    for x in (o.offset, o.offset + o.width)
                ],
            }
        )
        for start, end in zip(cuts, cuts[1:]):
            mid = (start + end) / 2
            hole = next(
                (o for o in openings if o.offset < mid < o.offset + o.width), None
            )
            if (
                hole
                and bottom >= hole.bottom - 1e-6
                and top <= hole.bottom + hole.height + 1e-6
            ):
                continue
            if end > start:
                parts.append(
                    LineString([line.interpolate(start), line.interpolate(end)]).buffer(
                        wall.thickness / 2, cap_style=2
                    )
                )
    return unary_union(parts)
