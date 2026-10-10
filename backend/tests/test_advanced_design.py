import io
import numpy as np
import pytest
import trimesh
from PIL import Image
from backend.app.floor_tiling import tiled_material
from backend.app.schemas import Layout
from backend.app.glb_builder import Builder
from backend.app.config import Settings
from backend.app.local_review import (
    LocalReviewRequest,
    LocalProposal,
    validate_proposal,
)
from backend.tests.test_workflow import layout_data
from backend.tests.test_workflow import FakeCodex, app_for, create_job, wait_job
from fastapi.testclient import TestClient
import json


def body(**changes):
    return LocalReviewRequest(
        layout=layout_data(),
        furniture={"items": [], "notes": []},
        target_type="walls",
        target_id="w0",
        **changes,
    )


def test_local_review_limits_scope_and_preserves_finishes():
    request = body()
    request.layout.walls[0].material_left = "wall-oak"
    value = {"id": "w0", "a": [0, 0], "b": [8, 0], "t": 0.2, "h": 2.7, "ext": True}
    proposal = LocalProposal(
        summary="依据尺寸核对墙厚",
        walls=[
            {
                "action": "update",
                "id": "w0",
                "value": value,
                "evidence": "图中墙体标注为 200 mm",
            }
        ],
    )
    result = validate_proposal(request, proposal)
    assert result["layout"]["walls"][0]["thickness"] == 0.2
    assert result["layout"]["walls"][0]["material_left"] == "wall-oak"
    assert (
        result["layout"]["rooms"]
        == request.layout.model_dump(exclude_unset=True)["rooms"]
    )
    proposal.walls[0].id = "w1"
    with pytest.raises(ValueError, match="范围"):
        validate_proposal(request, proposal)


def test_local_review_protects_locked_and_rejects_bad_geometry():
    request = body()
    request.layout.openings[0].edit_locked = True
    proposal = LocalProposal(
        summary="开口核对",
        openings=[{"wall_id": "w0", "values": [], "evidence": "无开口"}],
    )
    with pytest.raises(ValueError, match="锁定"):
        validate_proposal(request, proposal)
    wall = LocalProposal(
        summary="墙体复核",
        walls=[
            {
                "action": "update",
                "id": "w0",
                "value": {
                    "id": "w0",
                    "a": [0, 0],
                    "b": [8, 0],
                    "t": 0.2,
                    "h": 2.7,
                    "ext": True,
                },
                "evidence": "墙厚标注",
            }
        ],
    )
    with pytest.raises(ValueError, match="锁定"):
        validate_proposal(request, wall)
    proposal = LocalProposal(
        summary="疑点",
        issues=[{"target_type": "walls", "target_id": "w1", "text": "尺寸不清楚"}],
    )
    with pytest.raises(ValueError, match="范围"):
        validate_proposal(request, proposal)
    request.layout.walls[0].edit_locked = True
    with pytest.raises(ValueError, match="锁定"):
        validate_proposal(request, LocalProposal(summary="已核对"))


def test_tile_joints_texture_and_physical_uv(tmp_path):
    original = trimesh.visual.material.PBRMaterial(
        name="test",
        baseColorTexture=Image.new("RGB", (8, 8), "white"),
        baseColorFactor=[128, 64, 32, 255],
    )
    room = {
        "floor_tile_width": 0.4,
        "floor_tile_depth": 0.8,
        "floor_grout": 0.008,
        "floor_grout_color": "#6f706c",
    }
    result = tiled_material(original, room)
    assert result.baseColorTexture.getpixel((0, 0)) == (111, 112, 108)
    assert result.baseColorTexture.getpixel((256, 256)) == (188, 137, 99)
    assert original.baseColorTexture.getpixel((0, 0)) == (255, 255, 255)
    data = layout_data()
    data["rooms"][0].update(**room, floor_pattern="tiles")
    data = Layout.model_validate(data).model_dump()
    data.update(furniture=[], style="natural", furniture_mode="basic")
    Builder(data, Settings().furniture_catalog).build(tmp_path)
    scene = trimesh.load(tmp_path / "model.glb", force="scene")
    floors = []
    for (_, node), edge in scene.graph.transforms.edge_data.items():
        if edge.get("metadata", {}).get("structure_kind") == "room":
            mesh = scene.geometry[scene.graph[node][1]]
            floors.append(mesh)
            assert np.allclose(np.ptp(mesh.visual.uv, axis=0), [8 / 0.4, 6 / 0.8])
            assert mesh.visual.material.baseColorTexture is not None
    assert len(floors) == 1


def test_tiling_removes_old_joint_grid_and_retains_subpixel_joint():
    from backend.app.surface_materials import floor_material

    material = floor_material("floor-ivory-tile")
    room = {
        "floor_material": "floor-ivory-tile",
        "floor_tile_width": 3,
        "floor_tile_depth": 3,
        "floor_grout": 0.001,
        "floor_grout_color": "#6f706c",
    }
    result = tiled_material(material, room)
    image = np.asarray(result.baseColorTexture, dtype=float)
    assert np.max(np.abs(image[256, 256] - image[200, 200])) < 5
    assert image[0, 0].mean() < image[200, 200].mean()
    assert result.normalTexture.getpixel((256, 256)) == (128, 128, 255)


def test_extended_lights_have_distinct_geometry_and_glb_metadata(tmp_path):
    data = layout_data()
    data["lights"] = [
        {
            "id": kind,
            "name": kind,
            "kind": kind,
            "x": 2 + i,
            "y": 2,
            "elevation": 2.5,
            "edit_group": "客厅",
        }
        for i, kind in enumerate(["ceiling", "downlight", "table_lamp"])
    ]
    data = Layout.model_validate(data).model_dump()
    data.update(furniture=[], style="natural", furniture_mode="basic")
    Builder(data, Settings().furniture_catalog).build(tmp_path)
    scene = trimesh.load(
        io.BytesIO((tmp_path / "model.glb").read_bytes()),
        file_type="glb",
        force="scene",
    )
    kinds = set()
    for edge in scene.graph.transforms.edge_data.values():
        meta = edge.get("metadata", {})
        if meta.get("fixture_kind"):
            kinds.add(meta["fixture_kind"])
            assert meta["fixture_visual_placeholder"] is False
    assert kinds == {"ceiling", "downlight", "table_lamp"}


def test_local_review_route_runs_scoped_graph_without_overwriting_job(tmp_path):
    class ReviewCodex(FakeCodex):
        async def generate(self, **kwargs):
            if kwargs["schema"].get("title") == "LocalProposal":
                self.review_call = kwargs
                return json.dumps(
                    {
                        "summary": "所选墙体需核对窗户位置",
                        "issues": [
                            {
                                "target_type": "walls",
                                "target_id": "w0",
                                "text": "原图标注较小，建议人工核对窗宽",
                            }
                        ],
                    },
                    ensure_ascii=False,
                )
            return await super().generate(**kwargs)

    codex = ReviewCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        job = wait_job(client, create_job(client, False)["id"])
        assert job["status"] == "succeeded"
        path = f"/api/jobs/{job['id']}/artifacts/layout.json"
        saved = client.get(path).content
        response = client.post(
            f"/api/jobs/{job['id']}/review-local",
            json=body(model="test-chosen", reasoning_effort="high").model_dump(),
        )
        assert response.status_code == 200, response.text
        assert response.json()["issues"][0]["target_id"] == "w0"
        assert codex.review_call["model"] == "test-chosen"
        assert "floorplan-local-review" in codex.review_call["instructions"]
        assert client.get(path).content == saved
        assert (
            client.post(
                f"/api/jobs/{job['id']}/review-local",
                json=body(model="text-only").model_dump(),
            ).status_code
            == 422
        )
