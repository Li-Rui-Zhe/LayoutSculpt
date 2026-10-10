"""Thin decorative faces; structural solids and opening geometry stay unchanged."""

import math
import numpy as np
import trimesh
from shapely.geometry import box
from shapely.ops import unary_union

from .surface_materials import wall_material


def add_wall_surfaces(builder, cut_height):
    for wall in builder.document["walls"]:
        a, b = wall["start"], wall["end"]
        dx, dy = b["x"] - a["x"], b["y"] - a["y"]
        length = math.hypot(dx, dy)
        tangent = np.array([dx / length, 0, dy / length])
        normal = np.array([-dy / length, 0, dx / length])
        openings = [
            o for o in builder.document["openings"] if o["wall_id"] == wall["id"]
        ]
        holes = unary_union(
            [
                box(
                    o["offset"],
                    o["bottom"],
                    o["offset"] + o["width"],
                    o["bottom"] + o["height"],
                )
                for o in openings
            ]
        )
        surfaces = [
            dict(
                side=side,
                material=wall.get(f"material_{side}"),
                offset=0,
                width=length,
                bottom=0,
                height=wall["height"],
                layer=0,
            )
            for side in ["left", "right"]
            if wall.get(f"material_{side}")
        ]
        surfaces += [{**r, "layer": 1} for r in wall.get("finish_regions", [])]
        for region in surfaces:
            side = region["side"]
            sign = 1 if side == "left" else -1
            identifier = region["material"]
            for low, high in [
                (0, min(cut_height, wall["height"])),
                (cut_height, wall["height"]),
            ]:
                bottom, top = (
                    max(low, region["bottom"]),
                    min(high, region["bottom"] + region["height"]),
                )
                if top <= bottom:
                    continue
                shape = box(
                    region["offset"], bottom, region["offset"] + region["width"], top
                ).difference(holes)
                polygons = (
                    [shape]
                    if shape.geom_type == "Polygon"
                    else getattr(shape, "geoms", [])
                )
                for polygon in polygons:
                    if polygon.is_empty or polygon.area < 1e-7:
                        continue
                    vertices, faces = trimesh.creation.triangulate_polygon(
                        polygon, engine="earcut"
                    )
                    origin = np.array(
                        [a["x"] - builder.cx, 0, a["y"] - builder.cz]
                    ) + sign * normal * (
                        wall["thickness"] / 2 + 0.001 + region["layer"] * 0.001
                    )
                    points = (
                        origin
                        + vertices[:, 0, None] * tangent
                        + vertices[:, 1, None] * np.array([0, 1, 0])
                    )
                    mesh = trimesh.Trimesh(vertices=points, faces=faces, process=False)
                    if np.dot(mesh.face_normals[0], sign * normal) < 0:
                        mesh.invert()
                    builder.add(
                        f"墙面_{wall['id']}_{side}",
                        mesh,
                        "wall",
                        material=wall_material(identifier, builder.texture_root),
                        metadata={
                            "wall_id": wall["id"],
                            "wall_side": side,
                            "surface_overlay": True,
                            "cutaway_upper": bottom >= cut_height,
                        },
                    )
