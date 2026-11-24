import copy
import hashlib
import json

import numpy as np
import pytest
import trimesh

from backend.app.config import Settings
from backend.app.consistency import matches_confirmation, structure_hash, verify_export
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


def test_window_top_at_wall_height_survives_export_and_verification(tmp_path):
    data = document()
    data['walls'][0]['height'] = 1.95
    data['openings'][0].update(kind='window', bottom=.9, height=1.05)
    Builder(data, Settings().furniture_catalog).build(tmp_path)
    proof = verify_export(data, tmp_path / 'model.glb')
    assert proof['geometry_verified']
    assert proof['outline_verified']


def partition(wall_id, start, end):
    return {
        "id": wall_id, "start": {"x": start[0], "y": start[1]},
        "end": {"x": end[0], "y": end[1]}, "thickness": 0.16,
        "height": 2.7, "exterior": False,
    }


def test_slanted_window_junction_exports_solid_full_and_cutaway_walls(tmp_path):
    data = document()
    data["walls"].extend([
        partition("spine", (2, 0), (2.08, 6)),
        partition("divider", (2.03, 2.3), (7.99, 2.33)),
    ])
    data["openings"].append({
        **data["openings"][0], "kind": "window", "wall_id": "divider",
        "offset": 0.65, "width": 1.2, "bottom": 0.95, "height": 1.2,
    })
    Builder(data, Settings().furniture_catalog).build(tmp_path)
    model = tmp_path / "model.glb"
    assert verify_export(data, model)["geometry_verified"]
    scene = trimesh.load(model, force="scene")
    previews = [edge["metadata"]["cutaway_geometry"] for edge in scene.graph.transforms.edge_data.values()
                if edge.get("metadata", {}).get("cutaway_full")]
    assert previews
    for preview in previews:
        # Match the viewer's Float32BufferAttribute and GLB index buffer.
        mesh = trimesh.Trimesh(vertices=np.asarray(preview["positions"], dtype=np.float32).reshape(-1, 3),
                               faces=np.asarray(preview["indices"]).reshape(-1, 3))
        assert mesh.is_volume


@pytest.mark.parametrize("gap", [1e-12, 0.01], ids=["roundoff", "one-centimetre"])
def test_parallel_wall_contact_preserves_the_confirmed_cross_sections(tmp_path, gap):
    data = document()
    y = 2 + 0.16 + gap
    data["walls"].extend([
        partition("long", (0, 2), (6, 2)),
        partition("short", (0, y), (3, y)),
    ])
    Builder(data, Settings().furniture_catalog).build(tmp_path)
    proof = verify_export(data, tmp_path / "model.glb")
    assert max(section["difference_m2"] for section in proof["sections"]) < 1e-4


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
