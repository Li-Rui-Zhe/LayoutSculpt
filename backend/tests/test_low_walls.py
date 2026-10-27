"""低栏板从 AI 契约到建模保持实际高度，不影响室内墙与灯位。"""

import pytest
from shapely.geometry import Point

from backend.app.ai_contracts import pack_layout, unpack_layout
from backend.app.architecture import wall_sections
from backend.app.quality import finish_design
from backend.app.schemas import Furnishing, Layout
from backend.tests.test_workflow import layout_data


def low_wall_layout():
    data = layout_data()
    data["walls"][2]["height"] = 1.1
    return Layout.model_validate(data)


def test_low_parapet_survives_ai_roundtrip_and_has_no_upper_geometry():
    layout = unpack_layout(pack_layout(low_wall_layout()))
    assert [w.height for w in layout.walls] == [2.7, 2.7, 1.1, 2.7]
    sections = wall_sections(layout.model_dump())
    assert any(top == 1.1 and shape.covers(Point(4, 6)) for _, top, _, shape in sections)
    assert not any(shape.covers(Point(4, 6)) for bottom, _, _, shape in sections if bottom >= 1.1)
    assert any(top == 2.7 and shape.covers(Point(8, 3)) for _, top, _, shape in sections)


def test_low_wall_still_rejects_an_opening_above_its_top():
    data = low_wall_layout().model_dump()
    data["openings"][0]["wall_id"] = "w2"
    with pytest.raises(ValueError, match="门窗超出墙体高度"):
        Layout.model_validate(data)


def test_exported_glb_preserves_low_wall_sections(tmp_path):
    from backend.app.config import Settings
    from backend.app.consistency import verify_export
    from backend.app.glb_builder import Builder

    document = {**low_wall_layout().model_dump(), "furniture": [], "style": "natural"}
    Builder(document, Settings().furniture_catalog).build(tmp_path)
    proof = verify_export(document, tmp_path / "model.glb")
    assert proof["geometry_verified"] and proof["outline_verified"]


def test_low_parapet_does_not_lower_indoor_pendants():
    layout = low_wall_layout()
    result, _, _ = finish_design(layout, Furnishing(items=[], notes=[]))
    assert result.lights[0].elevation == pytest.approx(2.35)
    assert not layout.lights


def test_all_low_walls_use_default_ceiling_for_suggested_lights():
    data = layout_data()
    data["openings"] = []
    for wall in data["walls"]:
        wall["height"] = 1.1
    result, _, _ = finish_design(Layout.model_validate(data), Furnishing(items=[], notes=[]))
    assert result.lights[0].elevation == pytest.approx(2.35)


@pytest.mark.parametrize("height", [0, -1, 0.29, 4.51])
def test_invalid_wall_heights_remain_rejected(height):
    data = layout_data()
    data["walls"][2]["height"] = height
    with pytest.raises(ValueError):
        Layout.model_validate(data)
