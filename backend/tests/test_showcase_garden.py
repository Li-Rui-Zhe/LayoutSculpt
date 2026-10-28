"""验收实际交付模型的露台支撑、通道和卧室采光关系。"""

import numpy as np
import pytest
import trimesh
from shapely.geometry import box

from scripts.build_showcase import ROOT, SHOWCASE_ID, document


@pytest.fixture(scope="module")
def parts():
    scene = trimesh.load(ROOT / f"public/models/{SHOWCASE_ID}.glb", force="scene")
    result = []
    for node in scene.graph.nodes_geometry:
        transform, geometry = scene.graph[node]
        mesh = scene.geometry[geometry].copy()
        mesh.apply_transform(transform)
        result.append((node, mesh.bounds))
    return result


def bounds(parts, prefix):
    values = np.array([b for name, b in parts if name.startswith(prefix)])
    assert len(values), prefix
    return np.array([values[:, 0].min(axis=0), values[:, 1].max(axis=0)])


def test_outdoor_seats_have_grounded_legs_supported_cushions_and_backrests(parts):
    for prefix, ground in [("露台双人柚木沙发", .082), ("露台柚木休闲椅", .082)]:
        legs = bounds(parts, prefix + "落地支腿")
        boards = bounds(parts, prefix + "承重座板")
        seat = bounds(parts, prefix + "坐垫")
        back = bounds(parts, prefix + "靠背软垫")
        uprights = bounds(parts, prefix + "靠背立柱")
        assert legs[0, 1] == pytest.approx(ground, abs=1e-5)
        assert legs[1, 1] >= boards[0, 1]
        assert 0 <= seat[0, 1] - boards[1, 1] < .006
        assert back[0, 1] <= seat[1, 1]  # Back cushion rests on the seat.
        assert uprights[1, 1] > back[1, 1] - .06
    assert not any("露台长凳" in name or "庭院石钵" in name for name, _ in parts)


def test_terrace_keeps_an_eighty_centimetre_access_route(parts):
    doc = document()
    outline = np.array([[p["x"], p["y"]] for p in doc["outline"]])
    center = (outline.min(axis=0) + outline.max(axis=0)) / 2
    route = box(3.65, 7.29, 4.45, 8.45)
    for prefix in ["露台双人柚木沙发", "露台柚木休闲椅", "露台薄边洞石茶桌"]:
        extent = bounds(parts, prefix)[:, [0, 2]] + center
        footprint = box(*extent.flatten())
        assert not footprint.intersects(route), prefix


def test_bedroom_headboard_is_on_solid_wall_with_side_daylight():
    openings = document()["openings"]
    assert any(o["wall_id"] == "east" and o["kind"] == "window" and o["offset"] < 1 for o in openings)
    assert not any(o["wall_id"] == "north" and o["offset"] + o["width"] > 6.35 for o in openings)
