import copy
import hashlib
import json

import pytest
import trimesh

from backend.app.config import Settings
from backend.app.consistency import structure_hash, verify_export, matches_confirmation
from backend.app.glb_builder import Builder
from backend.app.schemas import Layout
from backend.tests.test_workflow import layout_data


def document():
    return {**Layout.model_validate(layout_data()).model_dump(), "furniture": [], "style": "natural"}


def test_exported_geometry_checks_room_outline_and_opening_sections(tmp_path):
    data = document()
    Builder(data, Settings().furniture_catalog).build(tmp_path)
    proof = verify_export(data, tmp_path / "model.glb")
    assert proof["geometry_verified"] and proof["outline_verified"]
    assert proof["floor_count"] == 1
    assert len(proof["sections"]) >= 2
    assert proof["structure_hash"] == structure_hash(data)


@pytest.mark.parametrize("target", ["walls", "floor", "outline"])
def test_shifted_geometry_is_rejected_even_when_volume_is_unchanged(tmp_path, target):
    data = document()
    Builder(data, Settings().furniture_catalog).build(tmp_path)
    scene = trimesh.load(tmp_path / "model.glb", force="scene")
    prefix = {"walls": "墙体_连续结构", "floor": "客厅_", "outline": "建筑基座_"}[target]
    for name, mesh in scene.geometry.items():
        if name.startswith(prefix):
            mesh.apply_translation([0.05, 0, 0])
    shifted = tmp_path / "shifted.glb"
    scene.export(shifted)
    with pytest.raises(ValueError, match="不一致"):
        verify_export(data, shifted)


def test_model_with_blocked_door_is_rejected(tmp_path):
    data = document()
    wrong = copy.deepcopy(data)
    wrong["openings"] = []
    Builder(wrong, Settings().furniture_catalog).build(tmp_path)
    with pytest.raises(ValueError, match="不一致"):
        verify_export(data, tmp_path / "model.glb")


def test_material_and_lighting_changes_keep_geometry_confirmation():
    original = document()
    changed = copy.deepcopy(original)
    changed["walls"][0]["finish"] = "sage"
    changed["rooms"][0]["floor_finish"] = "walnut"
    changed["lights"] = []
    assert structure_hash(changed) == structure_hash(original)
    changed["openings"][0]["width"] += 0.1
    assert structure_hash(changed) != structure_hash(original)


def test_numeric_serialization_does_not_change_confirmation_but_real_changes_do():
    original = document()
    original["openings"][0]["angle"] = 90
    original["outline"][0]["x"] = -0.0
    loaded = Layout.model_validate({key: value for key, value in original.items() if key in Layout.model_fields})
    assert structure_hash(loaded) == structure_hash(original)
    assert structure_hash(Layout.model_validate_json(loaded.model_dump_json())) == structure_hash(original)
    changed = loaded.model_copy(deep=True)
    changed.openings[0].width += 1e-9
    assert structure_hash(changed) != structure_hash(original)
    # An old record is valid only with its verified snapshot, never on trust.
    geometry = {
        "outline": original["outline"],
        "rooms": [{key: room[key] for key in ("id", "name", "kind", "polygon")} for room in original["rooms"]],
        "walls": [{key: wall[key] for key in ("id", "start", "end", "thickness", "height", "exterior")} for wall in original["walls"]],
        "openings": original["openings"],
    }
    legacy = hashlib.sha256(json.dumps(geometry, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    confirmation = {"structure_hash": legacy}
    assert not matches_confirmation(loaded, confirmation)
    assert matches_confirmation(loaded, confirmation, snapshot=original)
    assert not matches_confirmation(changed, confirmation, snapshot=original)
    modified = copy.deepcopy(original)
    modified["walls"][0]["thickness"] += 0.001
    assert not matches_confirmation(loaded, confirmation, snapshot=modified)
