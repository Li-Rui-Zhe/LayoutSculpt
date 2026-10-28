"""Balcony enclosures stay distinct through recognition, editing and export."""

from copy import deepcopy

import pytest
import trimesh
from shapely.geometry import Point

from backend.app.ai_contracts import apply_review_patch, pack_layout, unpack_layout
from backend.app.architecture import BOUNDARY_GLASS, structure_issues, wall_sections
from backend.app.balcony import boundary_frame_parts
from backend.app.config import Settings
from backend.app.consistency import structure_hash, verify_export
from backend.app.glb_builder import Builder
from backend.app.recognition_contract import (
    RecognitionContract,
    RecognitionOpening,
    RecognitionRoom,
)
from backend.app.schemas import Layout
from backend.app.surface_materials import WALL_MATERIALS
from backend.tests.test_ai_pipeline import patch_for
from backend.tests.test_workflow import layout_data


def balcony_layout(kind="glass_railing", height=1.1, sill=0.15):
    data = layout_data()
    data["rooms"][0].update(kind="balcony", name="休闲阳台", balcony_type="open")
    data["walls"][2].update(boundary_type=kind, height=height, sill_height=sill)
    return Layout.model_validate(data)


def test_recognition_and_review_preserve_balcony_glass_and_base_dimensions():
    layout = balcony_layout()
    wire = pack_layout(layout)
    payload = {k: v for k, v in wire.items() if k != "lights"}
    payload["input_check"] = {"status": "usable", "reason": "none", "evidence": "阳台及住宅墙体边界清晰可辨"}
    payload["rooms"] = [
        {k: v for k, v in r.items() if k in RecognitionRoom.model_fields}
        for r in wire["rooms"]
    ]
    payload["openings"] = [
        {k: v for k, v in o.items() if k in RecognitionOpening.model_fields}
        for o in wire["openings"]
    ]
    recognition = RecognitionContract.model_validate(payload)
    assert unpack_layout(recognition).walls[2] == layout.walls[2]
    assert unpack_layout(wire).rooms[0].balcony_type == "open"
    replacement = deepcopy(wire["walls"][2])
    replacement["sill_height"] = 0.3
    patch = patch_for(
        layout,
        walls=[
            {
                "action": "update",
                "id": "w2",
                "value": replacement,
                "evidence": "原图注明玻璃下方基座为 0.3 米",
            }
        ],
    )
    changed = apply_review_patch(layout, patch)
    assert changed.walls[2].boundary_type == "glass_railing"
    assert changed.walls[2].sill_height == 0.3
    assert changed.walls[1] == layout.walls[1]


@pytest.mark.parametrize(
    "kind,height,sill",
    [("glass_railing", 1.1, 0.15), ("glazing", 2.7, 0.8), ("glazing", 2.7, 0)],
)
def test_export_keeps_glass_transparent_and_base_solid_without_raising_guards(
    tmp_path, kind, height, sill
):
    data = balcony_layout(kind, height, sill).model_dump()
    # An existing wall paint must not turn the new glass into an opaque panel.
    data["walls"][2].update(
        wall_material=WALL_MATERIALS[0], material_left=WALL_MATERIALS[0]
    )
    doc = {**data, "style": "natural", "furniture": []}
    Builder(doc, Settings().furniture_catalog).build(tmp_path)
    assert verify_export(doc, tmp_path / "model.glb")["geometry_verified"]
    scene = trimesh.load(tmp_path / "model.glb", force="scene")
    glass = [
        m for m in scene.geometry.values() if m.visual.material.name == "阳台_清透玻璃"
    ]
    assert glass and all(m.visual.material.alphaMode == "BLEND" for m in glass)
    assert all(m.visual.material.baseColorFactor[3] < 80 for m in glass)
    assert max(m.bounds[1, 1] for m in glass) == pytest.approx(height)
    assert min(m.bounds[0, 1] for m in glass) == pytest.approx(sill)
    sections = wall_sections(data)
    center = Point(4, 6)
    assert all(
        finish == BOUNDARY_GLASS
        for low, high, finish, shape in sections
        if low >= sill and shape.covers(center)
    )
    assert not any(
        shape.covers(center) for low, _, _, shape in sections if low >= height
    )


def test_boundary_or_base_changes_invalidate_confirmation_but_legacy_defaults_do_not():
    original = Layout.model_validate(layout_data()).model_dump()
    for room in original["rooms"]:
        room.pop("balcony_type")
    for wall in original["walls"]:
        wall.pop("boundary_type")
        wall.pop("sill_height")
    assert structure_hash(original) == structure_hash(Layout.model_validate(original))
    layout = balcony_layout()
    changed = layout.model_copy(deep=True)
    changed.walls[2].boundary_type = "parapet"
    assert structure_hash(changed) != structure_hash(layout)
    changed = layout.model_copy(deep=True)
    changed.walls[2].sill_height += 0.1
    assert structure_hash(changed) != structure_hash(layout)


def test_open_balcony_high_wall_is_flagged_without_changing_any_height():
    layout = balcony_layout("wall", 2.7, 0)
    before = layout.model_dump()
    assert any(
        "层高实墙" in issue for issue in structure_issues(layout, include_access=False)
    )
    assert layout.model_dump() == before
    layout.rooms[0].balcony_type = "unknown"
    assert any(
        "开放/封闭" in issue for issue in structure_issues(layout, include_access=False)
    )


@pytest.mark.parametrize(
    "change,message", [({"sill_height": 1.1}, "基座"), ({"load_bearing": True}, "承重")]
)
def test_invalid_glass_boundary_is_rejected(change, message):
    data = balcony_layout().model_dump()
    data["walls"][2].update(change)
    with pytest.raises(ValueError, match=message):
        Layout.model_validate(data)


def test_glass_guard_cannot_silently_absorb_existing_door():
    data = balcony_layout().model_dump()
    data["walls"][0].update(boundary_type="glass_railing", sill_height=0)
    with pytest.raises(ValueError, match="栏板不能安装门窗"):
        Layout.model_validate(data)


def test_glazing_frames_leave_passage_clear():
    wall = balcony_layout("glazing", 2.7, 0).model_dump()["walls"][2]
    opening = {"offset": 1, "width": 2, "bottom": 0, "height": 2.1}
    parts = boundary_frame_parts(wall, [opening])
    assert parts
    assert not any(
        min(b, 3) - max(a, 1) > 0.03 and low < 2.1 and high > 0
        for a, b, low, high in parts
    )


def test_local_review_can_fix_only_selected_balcony_boundary():
    from backend.app.local_review import (
        LocalProposal,
        LocalReviewRequest,
        validate_proposal,
    )

    layout = balcony_layout("wall", 2.7, 0)
    wall = pack_layout(layout)["walls"][2]
    wall.update(boundary_type="glass_railing", h=1.1, sill_height=0.15)
    body = LocalReviewRequest(
        layout=layout,
        furniture={"items": [], "notes": []},
        target_type="walls",
        target_id="w2",
    )
    proposal = LocalProposal(
        summary="根据原图栏板线修正外缘",
        walls=[
            {
                "action": "update",
                "id": "w2",
                "value": wall,
                "evidence": "玻璃栏板非层高实墙",
            }
        ],
    )
    result = validate_proposal(body, proposal)
    assert result["layout"]["walls"][2]["boundary_type"] == "glass_railing"
