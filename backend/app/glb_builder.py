"""Build validated apartment layouts directly as GLB, without a Blender runtime."""

import argparse
import hashlib
import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from shapely.geometry import Point, Polygon

from .config import ROOT
from .architecture import wall_sections
from .furniture_details import construct, construct_basic, kitchen_details

CUT_HEIGHT = 1.2

PALETTES = {
    "natural": {
        "wall": (0.78, 0.75, 0.68),
        "wood": (0.55, 0.37, 0.21),
        "floor": (0.66, 0.51, 0.33),
        "fabric": (0.86, 0.83, 0.75),
        "accent": (0.36, 0.49, 0.41),
    },
    "cream": {
        "wall": (0.87, 0.84, 0.76),
        "wood": (0.69, 0.54, 0.36),
        "floor": (0.75, 0.64, 0.47),
        "fabric": (0.93, 0.87, 0.75),
        "accent": (0.63, 0.48, 0.36),
    },
    "modern": {
        "wall": (0.68, 0.70, 0.69),
        "wood": (0.29, 0.23, 0.19),
        "floor": (0.44, 0.36, 0.29),
        "fabric": (0.69, 0.73, 0.74),
        "accent": (0.21, 0.31, 0.37),
    },
}
NAMES = {
    "wall": "墙面_乳胶漆",
    "wood": "木材_实木",
    "floor": "地板_拼接木纹",
    "fabric": "软装_织物",
    "accent": "软装_配色织物",
    "stone": "石材_细纹",
    "white": "陶瓷_暖白",
    "metal": "金属_拉丝黄铜",
    "glass": "玻璃_浅蓝",
    "leaf": "植物_叶片",
    "base": "建筑_炭黑",
    "dark": "细节_石墨",
    "soil": "植物_土壤",
}
FIXED = {
    "stone": (0.76, 0.75, 0.70),
    "white": (0.90, 0.91, 0.88),
    "metal": (0.50, 0.39, 0.21),
    "glass": (0.26, 0.47, 0.51),
    "leaf": (0.18, 0.32, 0.13),
    "base": (0.055, 0.075, 0.077),
    "dark": (0.055, 0.065, 0.065),
    "soil": (0.09, 0.055, 0.03),
}
NORMALS = {
    "wood": "wood",
    "floor": "planks",
    "fabric": "linen",
    "accent": "linen",
    "stone": "stone",
}
ROLE_BY_NAME = {name: role for role, name in NAMES.items()}


@lru_cache(maxsize=2)
def tile_texture(dark=False):
    """Quiet 60 cm porcelain tiles, without the wood normal map used previously."""
    y, x = np.mgrid[:512, :512]
    noise = np.random.default_rng(8).normal(0, 0.65, (512, 512))
    joints = (x % 256 < 2) | (y % 256 < 2)
    base = np.array([174, 178, 175] if dark else [222, 216, 201])
    pixels = np.clip(base + noise[..., None] - joints[..., None] * 24, 0, 255).astype(
        np.uint8
    )
    return Image.fromarray(pixels)


@lru_cache(maxsize=6)
def wood_texture(style, floor=False):
    y, x = np.mgrid[:512, :512] / 512
    rng = np.random.default_rng(31)
    grain = 0.018 * np.sin((x * 65 + 0.18 * np.sin(y * 9)) * 2 * math.pi)
    grain += 0.012 * np.sin((x * 23 + 0.25 * np.sin(y * 5)) * 2 * math.pi)
    grain += rng.normal(0, 0.003, x.shape)
    factor = 0.91 + grain
    if floor:
        board = np.floor(x * 6).astype(int)
        factor += np.array([-0.018, 0.012, 0.005, -0.009, 0.022, -0.006])[board]
        joints = ((x * 6) % 1 < 0.008) | ((y + board * 0.317) % 1 < 0.004)
        factor = np.where(joints, factor * 0.77, factor)
    color = np.array(PALETTES[style]["floor" if floor else "wood"]) ** (1 / 2.2)
    return Image.fromarray(
        np.clip(color * factor[..., None] * 255, 0, 255).astype(np.uint8)
    )


def _material(role, style, finish=None):
    color = {**PALETTES[style], **FIXED}[role]
    name = NAMES[role] if not finish else f"{NAMES[role]}_{finish}"
    kwargs = {
        "name": name,
        "baseColorFactor": [*(round(c * 255) for c in color), 255],
        "roughnessFactor": 0.25
        if role in {"metal", "white", "glass"}
        else 0.92
        if role in {"fabric", "accent"}
        else 0.42
        if role in {"wood", "floor"}
        else 0.63,
        "metallicFactor": 0.78 if role == "metal" else 0,
    }
    if role == "glass":
        kwargs.update(
            alphaMode="BLEND", doubleSided=True, baseColorFactor=[66, 120, 130, 100]
        )
    if role in NORMALS:
        if role == "floor" and finish in {"tile", "stone"}:
            kwargs.update(
                baseColorFactor=[255, 255, 255, 255],
                baseColorTexture=tile_texture(finish == "stone"),
                roughnessFactor=0.68,
            )
            return trimesh.visual.material.PBRMaterial(**kwargs)
        if role in {"wood", "floor"}:
            texture_style = {"oak": "natural", "walnut": "modern"}.get(finish, style)
            kwargs.update(
                baseColorFactor=[255, 255, 255, 255],
                baseColorTexture=wood_texture(texture_style, role == "floor"),
                roughnessFactor=0.58 if role == "wood" else 0.65,
            )
            return trimesh.visual.material.PBRMaterial(**kwargs)
        color_file = (
            {
                "oak": "natural_floor_color.png",
                "walnut": "modern_floor_color.png",
                "tile": "cream_stone_color.png",
                "stone": "modern_stone_color.png",
            }.get(finish)
            if role == "floor"
            else None
        ) or f"{style}_{role}_color.png"
        textures = ROOT / "public" / "materials"
        kwargs["baseColorFactor"] = [255, 255, 255, 255]
        kwargs["baseColorTexture"] = Image.open(textures / color_file).copy()
        kwargs["normalTexture"] = Image.open(
            textures / f"{NORMALS[role]}_normal.png"
        ).copy()
    return trimesh.visual.material.PBRMaterial(**kwargs)


class Builder:
    def __init__(self, document, catalog_path):
        self.document = document
        self.scene = trimesh.Scene()
        self.style = document.get("style", "natural")
        self.materials = {role: _material(role, self.style) for role in NAMES}
        self.catalog_path = Path(catalog_path)
        self.catalog = json.loads(self.catalog_path.read_text(encoding="utf-8"))
        self.entries = {entry["kind"]: entry for entry in self.catalog["items"]}
        self.asset_cache = {}
        self.asset_hashes = {}
        self.instances = []
        self.fallback = []
        self.part_transform = None
        self.part_metadata = None
        self.cut_metadata = None
        self.node_index = 0
        outline = document["outline"]
        self.cx = (min(p["x"] for p in outline) + max(p["x"] for p in outline)) / 2
        self.cz = (min(p["y"] for p in outline) + max(p["y"] for p in outline)) / 2

    def add(self, name, mesh, role, transform=None, metadata=None, material=None):
        mat = material or self.materials[role]
        mesh = mesh.copy()
        mesh.unmerge_vertices()
        # A face has its own UVs, so adjacent faces can map textures independently.
        uv = np.zeros((len(mesh.vertices), 2), dtype=np.float64)
        for face, normal in zip(mesh.faces, mesh.face_normals):
            axis = int(np.argmax(np.abs(normal)))
            points = mesh.vertices[face]
            uv[face] = (
                points[:, (0, 2) if axis == 1 else (2, 1) if axis == 0 else (0, 1)] / 2
            )
        mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat)
        if self.part_transform is not None:
            transform = self.part_transform @ (
                transform if transform is not None else np.eye(4)
            )
        metadata = {**(self.part_metadata or {}), **(metadata or {})}
        # Scene graph node names are identifiers, not labels: duplicate names replace
        # earlier transforms. Every wall piece, window frame and lamp must be unique.
        self.node_index += 1
        node_name = f"{name}_{self.node_index}"
        self.scene.add_geometry(
            mesh,
            node_name=node_name,
            geom_name=node_name,
            transform=transform,
            metadata=metadata,
        )

    def box(self, name, center, size, role, angle=0, material=None, metadata=None):
        if min(size) <= 0:
            return
        mesh = trimesh.creation.box(extents=size)
        transform = trimesh.transformations.rotation_matrix(angle, [0, 1, 0])
        transform[:3, 3] = center
        self.add(name, mesh, role, transform, metadata=metadata, material=material)

    def architectural_box(self, name, center, size, role, angle=0, material=None):
        """Export full architecture; split at the viewer's cut plane with solid caps."""
        bottom, top = center[1] - size[1] / 2, center[1] + size[1] / 2
        for low, high in [
            (bottom, min(top, CUT_HEIGHT)),
            (max(bottom, CUT_HEIGHT), top),
        ]:
            if high - low < 0.001:
                continue
            self.box(
                name,
                [center[0], (low + high) / 2, center[2]],
                [size[0], high - low, size[2]],
                role,
                angle,
                material,
                {**(self.cut_metadata or {}), "cutaway_upper": low >= CUT_HEIGHT},
            )

    def cylinder(self, name, center, radius, height, role, metadata=None):
        mesh = trimesh.creation.cylinder(radius=radius, height=height, sections=24)
        mesh.apply_transform(
            trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])
        )
        self.add(name, mesh, role, trimesh.transformations.translation_matrix(center), metadata=metadata)

    def sphere(self, name, center, radii, role, metadata=None, material=None):
        mesh = trimesh.creation.icosphere(subdivisions=2)
        mesh.apply_scale(radii)
        self.add(
            name,
            mesh,
            role,
            trimesh.transformations.translation_matrix(center),
            metadata,
            material,
        )

    def slab(self, name, points, top, depth, role, material=None, metadata=None):
        polygon = Polygon([(p["x"] - self.cx, -(p["y"] - self.cz)) for p in points])
        mesh = trimesh.creation.extrude_polygon(polygon, depth, engine="earcut")
        mesh.apply_transform(
            trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])
        )
        mesh.apply_translation([0, top - depth, 0])
        self.add(name, mesh, role, material=material, metadata=metadata)

    def furniture(self, item, number):
        entry = self.entries.get(item["kind"])
        rotation = trimesh.transformations.rotation_matrix(
            -math.radians(item["rotation"]), [0, 1, 0]
        )
        placement = (
            trimesh.transformations.translation_matrix(
                [item["x"] - self.cx, 0.035, item["y"] - self.cz]
            )
            @ rotation
        )
        self.part_transform = placement
        self.part_metadata = {
            "room_id": item["room_id"],
            "furniture_index": number - 1,
            "furniture_name": item.get("name", ""),
        }
        try:
            detailed = construct(self, item)
            if not detailed and self.document.get("furniture_mode") == "basic":
                detailed = construct_basic(self, item)
        finally:
            self.part_transform = None
            self.part_metadata = None
        if detailed:
            self.instances.append(
                {
                    "asset_id": f"parametric_{item['kind']}",
                    "kind": item["kind"],
                    "room_id": item["room_id"],
                    "dimensions": [item["width"], item["depth"], item["height"]],
                }
            )
            return
        if self.document.get("furniture_mode", "library") == "library" and entry:
            path = self.catalog_path.parent / "glb" / f"{entry['kind']}.glb"
            if not path.is_file():
                raise FileNotFoundError(f"家具资产缺失：{path.name}")
            if entry["kind"] not in self.asset_cache:
                self.asset_hashes[entry["kind"]] = hashlib.sha256(
                    path.read_bytes()
                ).hexdigest()
                asset = trimesh.load(path, force="scene")
                parts = []
                for index, node in enumerate(asset.graph.nodes_geometry):
                    transform, geometry = asset.graph[node]
                    mesh = asset.geometry[geometry].copy()
                    role = ROLE_BY_NAME.get(mesh.visual.material.name)
                    if role:
                        mesh.visual.material = self.materials[role]
                    geom_name = f"asset_{entry['kind']}_{index}"
                    self.scene.geometry[geom_name] = mesh
                    parts.append((geom_name, transform))
                self.asset_cache[entry["kind"]] = parts
            scale = trimesh.transformations.scale_matrix(1)
            scale[0, 0] = item["width"] / entry["dimensions"][0]
            scale[1, 1] = item["height"] / entry["dimensions"][2]
            scale[2, 2] = item["depth"] / entry["dimensions"][1]
            place = placement @ scale
            for part, transform in self.asset_cache[entry["kind"]]:
                self.scene.graph.update(
                    frame_to=f"家具_{item['room_id']}_{number}_{part}",
                    matrix=place @ transform,
                    geometry=part,
                    metadata={
                        "room_id": item["room_id"],
                        "furniture_index": number - 1,
                        "asset_id": entry["id"],
                    },
                )
            self.part_transform = placement
            try:
                kitchen_details(self, item)
            finally:
                self.part_transform = None
            self.instances.append(
                {
                    "asset_id": entry["id"],
                    "kind": item["kind"],
                    "room_id": item["room_id"],
                    "dimensions": [item["width"], item["depth"], item["height"]],
                }
            )
            return
        if not entry and self.document.get("furniture_mode", "library") == "library":
            self.fallback.append(item["kind"])
        self.box(
            f"基础家具_{number}",
            [item["x"] - self.cx, item["height"] / 2 + 0.035, item["y"] - self.cz],
            [item["width"], item["height"], item["depth"]],
            "wood",
            -math.radians(item["rotation"]),
        )

    def light_fixture(self, fixture):
        x, y, z = fixture["x"] - self.cx, fixture["elevation"], fixture["y"] - self.cz
        colors = {
            2700: (1, 0.65, 0.32),
            3000: (1, 0.76, 0.48),
            4000: (1, 0.89, 0.73),
            6500: (0.88, 0.94, 1),
        }
        color = colors[fixture["temperature"]]
        material = trimesh.visual.material.PBRMaterial(
            name=f"灯泡_{fixture['id']}",
            baseColorFactor=[*(round(v * 255) for v in color), 255],
            emissiveFactor=[min(v * 2, 1) for v in color],
        )
        self.sphere(
            f"灯泡_{fixture['id']}",
            [x, y, z],
            [0.13, 0.12, 0.13],
            "white",
            {
                "fixture_id": fixture["id"],
                "fixture_lumens": fixture["lumens"],
                "fixture_kind": fixture["kind"],
                "fixture_temperature": fixture["temperature"],
                "fixture_enabled": fixture["enabled"],
                "fixture_visual_placeholder": fixture["kind"] != "floor_lamp",
            },
            material,
        )
        if fixture["kind"] == "floor_lamp":
            self.cylinder("落地灯底座", [x, 0.05, z], 0.22, 0.08, "metal")
            self.cylinder(
                "落地灯灯杆", [x, y / 2, z], 0.018, max(0.1, y - 0.12), "metal"
            )
            self.cylinder("落地灯顶罩", [x, y + 0.16, z], 0.24, 0.055, "wood")
        elif fixture["kind"] == "pendant":
            visual = {"fixture_visual_placeholder": True, "fixture_visual_id": fixture["id"]}
            self.cylinder("吊灯灯座", [x, y + 0.13, z], 0.055, 0.035, "metal", metadata=visual)
            self.cylinder("吊灯吊线", [x, y + 0.28, z], 0.004, 0.25, "metal", metadata=visual)
        else:
            self.cylinder("灯泡底座", [x, y + 0.13, z], 0.06, 0.08, "metal",
                          metadata={"fixture_visual_placeholder": True, "fixture_visual_id": fixture["id"]})

    def wall_network(self):
        """Union the wall footprint before extrusion, including L/T corners."""
        colors = {"white": (0.88, 0.89, 0.85), "cream": (0.84, 0.78, 0.66),
                  "sage": (0.52, 0.63, 0.49), "gray": (0.51, 0.56, 0.57)}
        groups = {}
        for bottom, top, finish, shape in wall_sections(self.document, CUT_HEIGHT):
            color = colors.get(finish)
            material = (trimesh.visual.material.PBRMaterial(
                name=f"墙面_微调_{finish}",
                baseColorFactor=[*(round(c * 255) for c in color), 255],
                roughnessFactor=0.75,
            ) if color else None)
            polygons = [shape] if shape.geom_type == "Polygon" else list(shape.geoms)
            for polygon in polygons:
                if polygon.geom_type != "Polygon" or polygon.area < 1e-8:
                    continue
                # Union leaves redundant collinear vertices. Earcut can omit
                # them from caps while extrusion retains them on sides.
                polygon = polygon.simplify(1e-7, preserve_topology=True)
                mesh = trimesh.creation.extrude_polygon(polygon, top - bottom, engine="earcut")
                # Plan y is world z; preserve triangle winding with a proper rotation.
                mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0]))
                mesh.apply_translation([-self.cx, top, -self.cz])
                groups.setdefault((finish, bottom >= CUT_HEIGHT), []).append(mesh)
                if bottom == 0:
                    trim = polygon.buffer(0.014, join_style=2).difference(polygon)
                    rings = [trim] if trim.geom_type == "Polygon" else list(trim.geoms)
                    for ring in rings:
                        if ring.geom_type != "Polygon" or ring.area < 1e-8:
                            continue
                        skirt = trimesh.creation.extrude_polygon(ring, 0.085, engine="earcut")
                        skirt.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0]))
                        skirt.apply_translation([-self.cx, 0.115, -self.cz])
                        self.add("连续踢脚线", skirt, "white")
        for finish in sorted({finish for finish, _ in groups}):
            color = colors.get(finish)
            material = (trimesh.visual.material.PBRMaterial(
                name=f"墙面_微调_{finish}",
                baseColorFactor=[*(round(c * 255) for c in color), 255],
                roughnessFactor=0.75,
            ) if color else None)
            # Explicit engine avoids runtime executable discovery. This removes
            # hidden coplanar caps at window-sill/lintel heights as well as seams.
            lower = groups.get((finish, False), [])
            upper = groups.get((finish, True), [])
            mesh = trimesh.boolean.union(lower + upper, engine="manifold")
            preview = trimesh.boolean.union(lower, engine="manifold") if lower else None
            self.add("墙体_连续结构", mesh, "wall", material=material,
                     metadata={"cutaway_full": True, "architecture_network": True,
                               "cut_height": CUT_HEIGHT,
                               "cutaway_geometry": {
                                   "positions": np.round(preview.vertices, 6).reshape(-1).tolist(),
                                   "indices": preview.faces.reshape(-1).tolist(),
                               } if preview is not None else None})

    def build(self, output):
        doc = self.document
        self.slab("建筑基座", doc["outline"], -0.04, 0.28, "base", metadata={"structure_kind": "outline"})
        self.slab("未铺设地板的基层", doc["outline"], 0.015, 0.065, "stone")
        for room in doc["rooms"]:
            if not room.get("floor_enabled", True):
                continue
            finish = room.get("floor_finish", "default")
            if finish == "default" and room["kind"] in {
                "bathroom",
                "kitchen",
                "balcony",
            }:
                finish = "tile"
            material = (
                _material("floor", self.style, finish) if finish != "default" else None
            )
            self.slab(room["name"], room["polygon"], 0.028, 0.015, "floor", material,
                      metadata={"structure_kind": "room", "room_id": room["id"]})
        self.wall_network()
        for wall in doc["walls"]:
            a, b = wall["start"], wall["end"]
            dx, dz = b["x"] - a["x"], b["y"] - a["y"]
            length = math.hypot(dx, dz)
            angle = -math.atan2(dz, dx)
            cx, cz = (a["x"] + b["x"]) / 2, (a["y"] + b["y"]) / 2
            height = wall["height"]
            nx, nz = -dz / length, dx / length
            outline = Polygon([(p["x"], p["y"]) for p in doc["outline"]])
            step = wall["thickness"] / 2 + 0.15
            plus_inside = outline.contains(Point(cx + nx * step, cz + nz * step))
            minus_inside = outline.contains(Point(cx - nx * step, cz - nz * step))
            if plus_inside:
                nx, nz = -nx, -nz
            self.cut_metadata = {
                "wall_id": wall["id"],
                "wall_exterior": wall["exterior"]
                and not (plus_inside and minus_inside),
                "wall_normal": [nx, nz],
            }
            openings = sorted(
                (o for o in doc["openings"] if o["wall_id"] == wall["id"]),
                key=lambda o: o["offset"],
            )
            for opening in openings:
                start, end = opening["offset"], opening["offset"] + opening["width"]
                bottom = min(opening["bottom"], height)
                top = min(opening["bottom"] + opening["height"], height)
                if opening["kind"] == "door" and opening.get("door_leaf", True):
                    at_end = opening.get("hinge", "start") == "end"
                    offset = end if at_end else start
                    hx, hz = (
                        a["x"] + dx * offset / length - self.cx,
                        a["y"] + dz * offset / length - self.cz,
                    )
                    leaf_angle = (
                        angle
                        + (math.pi if at_end else 0)
                        + math.radians(opening.get("angle", 90))
                        * (1 if opening.get("swing", "left") == "left" else -1)
                    )
                    width = max(0.03, opening["width"] - 0.04)
                    self.architectural_box(
                        f"门扇_{wall['id']}",
                        [
                            hx + math.cos(leaf_angle) * width / 2,
                            opening["height"] / 2,
                            hz - math.sin(leaf_angle) * width / 2,
                        ],
                        [width, opening["height"] - 0.02, 0.035],
                        "wood",
                        leaf_angle,
                    )
                if opening["kind"] == "door":
                    for edge in [start, end]:
                        self.architectural_box(
                            "门套",
                            [
                                a["x"] + dx * edge / length - self.cx,
                                opening["height"] / 2,
                                a["y"] + dz * edge / length - self.cz,
                            ],
                            [0.045, opening["height"], wall["thickness"] + 0.025],
                            "white",
                            angle,
                        )
                    self.architectural_box(
                        "门楣",
                        [
                            a["x"] + dx * (start + end) / 2 / length - self.cx,
                            opening["height"] + 0.025,
                            a["y"] + dz * (start + end) / 2 / length - self.cz,
                        ],
                        [end - start + 0.05, 0.05, wall["thickness"] + 0.025],
                        "white",
                        angle,
                    )
                if opening["kind"] == "window" and top > bottom + 0.05:
                    t = (start + end) / 2 / length
                    px, pz = a["x"] + dx * t - self.cx, a["y"] + dz * t - self.cz
                    self.architectural_box(
                        "窗玻璃",
                        [px, (bottom + top) / 2, pz],
                        [end - start, top - bottom, 0.025],
                        "glass",
                        angle,
                    )
                    for level in [bottom, top]:
                        self.architectural_box(
                            "窗横框",
                            [px, level, pz],
                            [end - start + 0.035, 0.035, 0.07],
                            "white",
                            angle,
                        )
                    self.architectural_box(
                        "窗台石",
                        [px, bottom - 0.025, pz],
                        [end - start + 0.07, 0.05, wall["thickness"] + 0.10],
                        "stone",
                        angle,
                    )
                    for offset in (start, end, (start + end) / 2):
                        t = offset / length
                        self.architectural_box(
                            "窗框",
                            [
                                a["x"] + dx * t - self.cx,
                                (bottom + top) / 2,
                                a["y"] + dz * t - self.cz,
                            ],
                            [0.035, top - bottom, 0.065],
                            "white",
                            angle,
                        )
        for index, item in enumerate(doc["furniture"], 1):
            self.furniture(item, index)
        for fixture in doc.get("lights", []):
            self.light_fixture(fixture)

        def extras(tree):
            for material in tree.get("materials", []):
                if "normalTexture" in material:
                    material["normalTexture"]["scale"] = 0.18
                name = material.get("name", "")
                role = next(
                    (key for key, value in NAMES.items() if name.startswith(value)),
                    None,
                )
                if name.startswith("墙面_微调_"):
                    role = "wall"
                elif name.startswith("地板_微调_"):
                    role = "floor"
                category = {
                    "wall": "walls",
                    "floor": "floor",
                    "fabric": "fabric",
                    "accent": "fabric",
                }.get(role)
                if category:
                    material["extras"] = {"surface_category": category}

        output.mkdir(parents=True, exist_ok=True)
        (output / "model.glb").write_bytes(
            self.scene.export(file_type="glb", tree_postprocessor=extras)
        )
        report = {
            "mode": doc.get("furniture_mode", "library"),
            "engine": "trimesh",
            "total": len(doc["furniture"]),
            "matched": len(self.instances),
            "fallback": self.fallback,
            "instances": self.instances,
            "version": self.catalog["version"],
            "assets": self.asset_hashes,
        }
        (output / "furniture-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--layout", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-catalog", type=Path, required=True)
    args = parser.parse_args()
    Builder(
        json.loads(args.layout.read_text(encoding="utf-8")), args.asset_catalog
    ).build(args.output)


if __name__ == "__main__":
    main()
