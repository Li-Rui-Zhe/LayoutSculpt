"""Exercise the production builder with a real asset and no Blender executable."""

import asyncio
import json
import struct
from dataclasses import replace

import trimesh
import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.modeling import build_model
from backend.app.glb_builder import Builder
from backend.app.schemas import Furnishing, Layout
from backend.tests.test_workflow import (
    FakeCodex,
    create_job,
    furniture_data,
    layout_data,
    wait_job,
)


def test_automatic_concave_outline_keeps_more_than_40_corners(tmp_path):
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    layout = layout_data()
    layout.update(walls=[], openings=[], lights=[])
    layout["rooms"] = [
        {"id": f"r{i}", "name": f"空间{i}", "kind": "other",
         "polygon": [{"x": x, "y": y} for x, y in
                     [(i, 0), (i + 1, 0), (i + 1, 2 + i % 2), (i, 2 + i % 2)]]}
        for i in range(24)
    ]
    footprint = unary_union([
        Polygon([(p["x"], p["y"]) for p in room["polygon"]])
        for room in layout["rooms"]
    ])
    layout["outline"] = [{"x": x, "y": y} for x, y in list(footprint.exterior.coords)[:-1]]
    assert len(layout["outline"]) > 40
    report = asyncio.run(build_model(Settings(), tmp_path, Layout.model_validate(layout),
                                     Furnishing(items=[], notes=[]), "natural"))
    scene = trimesh.load(tmp_path / "model.glb", force="scene")
    assert scene.extents[0] == pytest.approx(24)
    assert scene.extents[2] == pytest.approx(3)
    assert report["consistency"]["geometry_verified"]
    assert report["consistency"]["outline_verified"]


def test_new_layout_exports_glb_without_blender(tmp_path, monkeypatch):
    monkeypatch.setenv("BLENDER_PATH", str(tmp_path / "missing-blender.exe"))
    layout = layout_data()
    layout["lights"] = [
        {
            "id": "lamp",
            "name": "阅读灯",
            "kind": "floor_lamp",
            "x": 3,
            "y": 3,
            "elevation": 1.6,
            "lumens": 900,
            "temperature": 2700,
            "enabled": True,
        }
    ]
    report = asyncio.run(
        build_model(
            Settings(),
            tmp_path,
            Layout.model_validate(layout),
            Furnishing.model_validate(furniture_data()),
            "natural",
        )
    )
    assert report["engine"] == "trimesh"
    assert report["matched"] == 1
    assert not (tmp_path / "model.blend").exists()
    scene = trimesh.load(tmp_path / "model.glb", force="scene")
    assert scene.extents[0] >= 8
    assert scene.extents[1] >= 2.7
    with (tmp_path / "model.glb").open("rb") as file:
        file.read(12)
        length, _ = struct.unpack("<II", file.read(8))
        gltf = json.loads(file.read(length))
    assert any(
        node.get("extras", {}).get("fixture_id") == "lamp" for node in gltf["nodes"]
    )
    assert any(
        material.get("extras", {}).get("surface_category") == "floor"
        for material in gltf["materials"]
    )
    assert gltf.get("textures")


def test_bare_fixture_parts_keep_light_records_with_placeholder_metadata(tmp_path):
    data = Layout.model_validate(layout_data()).model_dump()
    data.update(furniture=[], style="natural")
    data["lights"] = [
        {"id": kind, "name": kind, "kind": kind, "x": index + 2, "y": 3,
         "elevation": 2.4, "lumens": 900, "temperature": 3000, "enabled": True}
        for index, kind in enumerate(["bulb", "pendant", "floor_lamp"])
    ]
    Builder(data, Settings().furniture_catalog).build(tmp_path)
    with (tmp_path / "model.glb").open("rb") as file:
        file.read(12)
        length, _ = struct.unpack("<II", file.read(8))
        gltf = json.loads(file.read(length))
    sources = {node["extras"]["fixture_id"]: node["extras"] for node in gltf["nodes"]
               if node.get("extras", {}).get("fixture_id")}
    assert sources.keys() == {"bulb", "pendant", "floor_lamp"}
    assert all(source["fixture_lumens"] == 900 for source in sources.values())
    assert sources["bulb"]["fixture_visual_placeholder"] is True
    assert sources["pendant"]["fixture_visual_placeholder"] is True
    assert sources["floor_lamp"]["fixture_visual_placeholder"] is False
    parts = [node["extras"] for node in gltf["nodes"]
             if node.get("extras", {}).get("fixture_visual_id")]
    assert len(parts) == 3
    assert all(part["fixture_visual_placeholder"] for part in parts)


def test_all_wall_segments_survive_export_with_full_height_and_true_tile_material(
    tmp_path,
):
    data = Layout.model_validate(layout_data()).model_dump()
    data.update(furniture=[], style="natural")
    data["rooms"][0]["floor_finish"] = "tile"
    Builder(data, Settings().furniture_catalog).build(tmp_path)
    scene = trimesh.load(tmp_path / "model.glb", force="scene")
    walls = [mesh for name, mesh in scene.geometry.items() if name.startswith("墙体_")]
    # The continuous wall ring has joined corners and a true door void.
    # Reusing node identifiers used to silently drop pieces around openings.
    expected = ((8.16 * 6.16 - 7.84 * 5.84) * 2.7 - 0.9 * 2.1 * 0.16)
    assert sum(mesh.volume for mesh in walls) == pytest.approx(expected, rel=1e-5)
    assert len(walls) == 1
    for mesh in walls:
        # GLB has separate UV vertices; weld only for this topology assertion.
        welded = mesh.copy()
        welded.merge_vertices(merge_tex=True, merge_norm=True)
        assert welded.is_watertight
    floor = next(
        mesh for name, mesh in scene.geometry.items() if name.startswith("客厅")
    )
    assert floor.visual.material.normalTexture is None
    assert floor.visual.material.baseColorTexture is not None


def test_repeated_furniture_parts_are_all_retained(tmp_path):
    data = Layout.model_validate(layout_data()).model_dump()
    data.update(
        furniture=[
            dict(
                room_id="living",
                name="茶几",
                kind="table",
                x=3,
                y=3,
                width=1,
                depth=0.6,
                height=0.45,
                rotation=0,
            )
        ],
        style="natural",
    )
    Builder(data, Settings().furniture_catalog).build(tmp_path)
    scene = trimesh.load(tmp_path / "model.glb", force="scene")
    legs = [name for name in scene.graph.nodes_geometry if name.startswith("茶几桌脚")]
    assert len(legs) == 4


def test_api_generates_new_job_without_blender(tmp_path, monkeypatch):
    monkeypatch.setenv("BLENDER_PATH", str(tmp_path / "missing-blender.exe"))
    app = create_app(replace(Settings(), data_dir=tmp_path), client=FakeCodex())
    with TestClient(app) as client:
        health = client.get("/api/health").json()
        assert health["furniture_library"]["available"]
        assert health["model_builder"]["engine"] == "trimesh"
        job = wait_job(client, create_job(client, collaboration=False)["id"])
        assert job["status"] == "succeeded", job
        assert "blend_url" not in job["result"]
        assert client.get(job["result"]["model_url"]).content.startswith(b"glTF")
