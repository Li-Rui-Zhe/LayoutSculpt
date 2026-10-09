import math

import numpy as np
import pytest
import trimesh

from backend.app.config import Settings
from backend.app.schemas import Furniture, Furnishing, Layout
from backend.app.quality import furnishing_issues, prepare_generated_furnishing
from backend.app.shower_layout import placement_issues
from scripts.build_showcase import document


def sample():
    doc = document()
    return Layout.model_validate({k: v for k, v in doc.items() if k in Layout.model_fields}), Furniture.model_validate(next(f for f in doc["furniture"] if f["kind"] == "shower_walk_in"))


@pytest.mark.parametrize("angle", [0, 90, 180, 270, 33])
def test_window_avoidance_respects_rotation_and_integrated_types(angle):
    layout, shower = sample()
    a = math.radians(angle)
    def rotate(x, y):
        return x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
    for wall in layout.walls:
        for point in [wall.start, wall.end]:
            point.x, point.y = rotate(point.x, point.y)
    shower.x, shower.y = rotate(shower.x, shower.y)
    shower.rotation = angle
    assert placement_issues(shower, layout) == []
    assert placement_issues(shower.model_copy(update={"kind": "shower_open"}), layout) == []
    assert any("遮挡窗户" in message for message in placement_issues(shower.model_copy(update={"kind": "shower"}), layout))


def test_mounting_window_and_front_access_are_checked():
    layout, shower = sample()
    assert any("完整实墙" in s for s in placement_issues(shower.model_copy(update={"rotation": 90}), layout))
    # Install a window across the former solid mounting area.
    layout.openings.append(layout.openings[0].model_copy(update={"wall_id": "study_bath", "offset": 2.5, "width": .8, "bottom": 1, "height": 1.2}))
    assert any("完整实墙" in s for s in placement_issues(shower, layout))
    layout, shower = sample()
    obstacle = shower.model_copy(update={"kind": "cabinet", "name": "入口障碍", "y": 8.05, "width": .6, "depth": .4, "height": .8})
    assert any("入口受阻" in s for s in furnishing_issues(Furnishing(items=[shower, obstacle], notes=[]), layout))
    for changes in [{"width": .6}, {"depth": .6}, {"height": 1.5}, {"elevation": .4}]:
        assert placement_issues(shower.model_copy(update=changes), layout)


def test_auto_placement_keeps_valid_integrated_shower():
    layout, shower = sample()
    plan = prepare_generated_furnishing(Furnishing(items=[shower], notes=[]), layout)
    assert plan.items == [shower]
    assert furnishing_issues(plan, layout) == []


@pytest.mark.parametrize("kind", ["shower_walk_in", "shower_open"])
def test_integrated_mesh_has_no_tall_opaque_panels(kind):
    scene = trimesh.load(Settings().furniture_catalog.parent / f"glb/{kind}.glb", force="scene")
    glass = []
    for node in scene.graph.nodes_geometry:
        transform, name = scene.graph[node]
        mesh = scene.geometry[name].copy()
        mesh.apply_transform(transform)
        label = mesh.visual.material.name
        if "瓷板" in label:
            assert mesh.bounds[1, 1] < .03
        if "透明玻璃" in label:
            glass.append(mesh)
            assert mesh.bounds[1, 0] < -.44  # Only the left partition survives.
    assert bool(glass) == (kind == "shower_walk_in")
    assert np.allclose(scene.extents, [1, 2.1, 1], atol=1e-4)
