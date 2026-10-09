import json
import pytest
import trimesh
from pydantic import ValidationError
from backend.app.schemas import Room, Layout
from backend.app.glb_builder import Builder
from backend.app.config import Settings
from backend.app.surface_materials import FLOOR_MATERIALS, floor_material
from backend.app.consistency import verify_export
from backend.tests.test_workflow import layout_data


def test_floor_catalog_validation_and_legacy_compatibility():
    room = layout_data()["rooms"][0]
    assert Room.model_validate(room).floor_material is None
    for identifier in FLOOR_MATERIALS:
        assert Room.model_validate({**room, "floor_material": identifier}).floor_material == identifier
        material = floor_material(identifier)
        assert material.baseColorFactor[3] == 255
    with pytest.raises(ValidationError):
        Room.model_validate({**room, "floor_material": "unknown"})
    with pytest.raises(ValidationError):
        Room.model_validate({**room, "floor_material": "teal"})


def test_different_room_floors_survive_real_glb_export(tmp_path):
    data = layout_data()
    def polygon(x0, x1):
        return [{"x": x, "y": y} for x, y in [(x0, 0), (x1, 0), (x1, 6), (x0, 6)]]
    data["rooms"] = [
        {"id": "living", "name": "客厅", "kind": "living", "polygon": polygon(0, 4), "floor_material": "honey"},
        {"id": "bedroom", "name": "卧室", "kind": "bedroom", "polygon": polygon(4, 8), "floor_material": "charcoal"},
    ]
    data = Layout.model_validate(data).model_dump()
    data.update(style="natural", furniture_mode="basic", furniture=[])
    Builder(data, Settings().furniture_catalog).build(tmp_path)
    path = tmp_path / "model.glb"
    assert verify_export(data, path)["geometry_verified"]
    scene = trimesh.load(path, force="scene")
    exported = {}
    for (_, node), edge in scene.graph.transforms.edge_data.items():
        meta = edge.get("metadata", {})
        if meta.get("structure_kind") == "room":
            mesh = scene.geometry[scene.graph[node][1]]
            exported[meta["room_id"]] = mesh.visual.material
            assert meta["room_name"] in {"客厅", "卧室"}
    assert exported["living"].name == "地板_素材_honey"
    assert exported["bedroom"].name == "地板_素材_charcoal"
    assert exported["living"].baseColorTexture is not None
    assert exported["bedroom"].baseColorTexture is None
    assert exported["living"].baseColorFactor.tolist() != exported["bedroom"].baseColorFactor.tolist()
