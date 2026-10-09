"""餐椅的实际发布网格：尺寸稳定、曲面封闭、座框与靠背支撑连接。"""
import numpy as np
import pytest
import trimesh

from backend.app.config import Settings


def test_chair_structure_and_solid_curved_back():
    scene = trimesh.load(Settings().furniture_catalog.parent / "glb/chair.glb", force="scene")
    meshes = {}
    for node in scene.graph.nodes_geometry:
        transform, geometry = scene.graph[node]
        mesh = scene.geometry[geometry].copy()
        mesh.apply_transform(transform)
        meshes[node] = mesh
        assert mesh.is_watertight and mesh.volume > 0
        assert np.isfinite(mesh.vertex_normals).all()
    assert len(meshes) == 10
    assert scene.extents == pytest.approx([.5, .84, .54], abs=1e-5)
    assert {m.visual.material.name for m in meshes.values()} == {"木材_实木", "软装_织物"}
    back = meshes["完整弧面软包靠背"]
    seat = meshes["整块圆角软包座垫"]
    assert .46 < seat.bounds[1, 1] < .49
    assert .28 < back.extents[1] < .33
    assert back.bounds[0, 1] > seat.bounds[1, 1]
    # Rear legs continue into the upholstered back, with no floating backrest.
    for side in ["左", "右"]:
        rear = meshes[f"{side}后腿连靠背支柱"]
        overlap = np.minimum(rear.bounds[1], back.bounds[1]) - np.maximum(rear.bounds[0], back.bounds[0])
        assert (overlap > 0).all()
        assert rear.bounds[0, 1] == pytest.approx(0, abs=1e-6)
        front = meshes[f"{side}前实木椅腿"]
        assert front.bounds[0, 1] == pytest.approx(0, abs=1e-6)
        assert front.bounds[1, 1] > seat.bounds[0, 1] - .001
    for name in ["前座框", "后座框", "左座框", "右座框"]:
        frame = meshes[name]
        assert frame.bounds[0, 1] < seat.bounds[0, 1] < frame.bounds[1, 1]
