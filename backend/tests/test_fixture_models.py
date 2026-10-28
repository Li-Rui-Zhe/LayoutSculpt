import numpy as np
import pytest
from backend.app.fixture_models import PRESETS, fixture_parts


@pytest.mark.parametrize("preset", PRESETS, ids=lambda p:p["kind"])
def test_fixture_geometry_has_one_emitter_and_owned_visible_parts(preset):
    fixture = dict(preset,id="test",temperature=3000,enabled=True)
    parts = fixture_parts(fixture)
    assert len(parts) >= 2
    sources = [meta for _,_,meta in parts if meta.get("fixture_id")]
    assert len(sources) == 1
    assert sources[0]["fixture_lumens"] == preset["lumens"]
    for _,mesh,meta in parts:
        assert meta["fixture_owner_id"] == "test"
        assert meta["fixture_visual_placeholder"] == (preset["kind"] in {"bulb","pendant"})
        assert np.isfinite(mesh.vertices).all() and np.isfinite(mesh.vertex_normals).all()
        assert mesh.is_watertight and mesh.volume > 0
    if preset["kind"] == "floor_lamp":
        assert min(mesh.bounds[0,1] for _,mesh,_ in parts) == pytest.approx(.035)
        shades = [mesh for _,mesh,meta in parts if meta.get("fixture_soft_shadow")]
        assert shades and shades[0].extents[1] > .3
