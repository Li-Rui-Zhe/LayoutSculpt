"""Trace structure to its source and verify exported wall cross sections."""

import hashlib
import json

import numpy as np
import trimesh
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union, polygonize_full

from .architecture import wall_sections


def _structure_geometry(layout):
    data = layout.model_dump() if hasattr(layout, "model_dump") else layout
    return {
        "outline": data["outline"],
        "rooms": [{k: r[k] for k in ("id", "name", "kind", "polygon")} for r in data["rooms"]],
        "walls": [{k: w[k] for k in ("id", "start", "end", "thickness", "height", "exterior")} for w in data["walls"]],
        "openings": data["openings"],
    }


def _numeric_geometry(value):
    if isinstance(value, dict):
        return {key: _numeric_geometry(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_numeric_geometry(item) for item in value]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        # JSON/Pydantic can represent the same dimension as 90 or 90.0.
        # Keep every significant digit; real geometry changes must still fail.
        return float(value) if value else 0.0
    return value


def _geometry_digest(geometry):
    return hashlib.sha256(json.dumps(geometry, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def structure_hash(layout):
    return _geometry_digest(_numeric_geometry(_structure_geometry(layout)))


def matches_confirmation(layout, confirmation, *, snapshot=None):
    expected = structure_hash(layout)
    if confirmation.get("structure_hash") == expected:
        return True
    # Accept an old hash only when it verifies its exact persisted snapshot,
    # and that snapshot is numerically identical to the current structure.
    return bool(snapshot is not None
                and confirmation.get("structure_hash") == _geometry_digest(_structure_geometry(snapshot))
                and structure_hash(snapshot) == expected)


def source_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_export(document, model_path):
    """Check the actual GLB, not just a success flag written by the builder."""
    scene = trimesh.load(model_path, force="scene")
    outline = document["outline"]
    cx = (min(p["x"] for p in outline) + max(p["x"] for p in outline)) / 2
    cy = (min(p["y"] for p in outline) + max(p["y"] for p in outline)) / 2
    metadata = {child: data.get("metadata", {}) for (_, child), data in scene.graph.transforms.edge_data.items()}
    footprints = {}
    walls = []
    for node in scene.graph.nodes_geometry:
        transform, name = scene.graph[node]
        meta = metadata.get(node, {})
        if not name.startswith("墙体_连续结构") and meta.get("structure_kind") not in {"room", "outline"}:
            continue
        mesh = scene.geometry[name].copy()
        mesh.apply_transform(transform)
        mesh.merge_vertices(merge_tex=True, merge_norm=True)
        if not mesh.is_volume:
            raise ValueError("导出建筑结构不是闭合实体，请检查建模结果")
        if meta.get("structure_kind") in {"room", "outline"}:
            key = ("room", meta.get("room_id")) if meta["structure_kind"] == "room" else ("outline", None)
            if key in footprints:
                raise ValueError("导出空间存在重复地板，已阻止交付")
            faces = mesh.triangles[mesh.face_normals[:, 1] > 0.99]
            footprints[key] = unary_union([Polygon(triangle[:, [0, 2]] + [cx, cy]) for triangle in faces])
            continue
        walls.append(mesh)
    expected_footprints = {("outline", None): Polygon([(p["x"], p["y"]) for p in outline]),
                           **{("room", room["id"]): Polygon([(p["x"], p["y"]) for p in room["polygon"]])
                              for room in document["rooms"] if room.get("floor_enabled", True)}}
    if footprints.keys() != expected_footprints.keys():
        raise ValueError("导出空间或户型基座有遗漏，已阻止交付")
    for key, expected in expected_footprints.items():
        if expected.symmetric_difference(footprints[key]).area > max(0.002, expected.length * 2e-5):
            raise ValueError("导出地板或户型轮廓与确认结构不一致，已阻止交付")
    sections = wall_sections(document)
    expected_volume = sum((top - bottom) * shape.area for bottom, top, _, shape in sections)
    actual_volume = sum(mesh.volume for mesh in walls)
    if not np.isclose(expected_volume, actual_volume, rtol=1e-4, atol=1e-4):
        raise ValueError("导出墙体体积与确认的结构不一致，已阻止交付")
    checks = []
    for low, high in sorted({(low, high) for low, high, _, _ in sections}):
        # Avoid slicing exactly through a triangulation vertex at a midpoint.
        elevation = low + (high - low) * 0.413271
        expected = unary_union([shape for bottom, top, _, shape in sections if bottom == low and top == high])
        actual = Polygon()
        for mesh in walls:
            lines = trimesh.intersections.mesh_plane(mesh, plane_origin=[0, elevation, 0], plane_normal=[0, 1, 0])
            if not len(lines):
                continue
            segments = [LineString(np.round(line[:, [0, 2]] + [cx, cy], 6)) for line in lines]
            polygons, cuts, dangles, invalid = polygonize_full(unary_union(segments))
            # Closed meshes may produce interior cut edges on coplanar faces;
            # these do not change the enclosed cross-sectional area.
            if not dangles.is_empty or not invalid.is_empty:
                raise ValueError("导出墙体截面存在未闭合边界")
            shape = Polygon()
            for polygon in polygons.geoms:
                ring = Polygon(polygon.exterior)
                shape = shape.symmetric_difference(ring)
            actual = actual.union(shape)
        error = expected.symmetric_difference(actual).area
        if error > max(0.002, expected.length * 2e-5):
            raise ValueError(f"导出模型在 {elevation:.2f} 米处墙体/门窗截面不一致，已阻止交付")
        checks.append({"elevation": round(elevation, 4), "difference_m2": round(error, 8)})
    return {"geometry_verified": True, "structure_hash": structure_hash(document),
            "floor_count": len(footprints) - 1, "outline_verified": True,
            "model_sha256": source_hash(model_path), "wall_volume_m3": round(float(actual_volume), 6),
            "sections": checks, "tolerance": "截面面积误差 ≤ max(0.002㎡, 周长×0.00002m)"}
