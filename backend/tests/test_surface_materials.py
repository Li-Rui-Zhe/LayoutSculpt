import json
import pytest
import trimesh
from pydantic import ValidationError
from backend.app.schemas import Room, Wall, Layout
from backend.app.glb_builder import Builder
from backend.app.config import Settings
from backend.app.surface_materials import FLOOR_MATERIALS, WALL_MATERIALS, floor_material, wall_material
from backend.app.consistency import verify_export
from backend.tests.test_workflow import layout_data


def test_wall_material_validation_and_legacy_default():
    wall = layout_data()["walls"][0]
    assert Wall.model_validate(wall).wall_material is None
    for identifier in WALL_MATERIALS:
        assert Wall.model_validate({**wall, "wall_material": identifier}).wall_material == identifier
        assert wall_material(identifier).normalTexture is not None
    for identifier in ["floor-oak", "color:#123456", "missing"]:
        with pytest.raises(ValidationError):
            Wall.model_validate({**wall, "wall_material": identifier})


@pytest.mark.parametrize("first,second", [
    ("wall-oak", "wall-lime"),
    ("wall-white", "wall-light-gray"),
    ("wall-white-tile", "wall-marble"),
])
def test_each_wall_keeps_its_material_and_openings_in_real_glb(tmp_path, first, second):
    data = layout_data()
    original = json.loads(json.dumps(data))
    data["walls"][0]["wall_material"] = first
    data["walls"][1]["wall_material"] = second
    data = Layout.model_validate(data).model_dump()
    data.update(style="natural", furniture_mode="basic", furniture=[])
    Builder(data, Settings().furniture_catalog).build(tmp_path)
    assert verify_export(data, tmp_path / "model.glb")["geometry_verified"]
    scene = trimesh.load(tmp_path / "model.glb", force="scene")
    exported = {}
    for (_, node), edge in scene.graph.transforms.edge_data.items():
        meta = edge.get("metadata", {})
        if meta.get("wall_material"):
            mesh = scene.geometry[scene.graph[node][1]]
            assert meta["cutaway_geometry"]["positions"]
            assert mesh.visual.material.baseColorTexture is not None
            for wall_id in meta["wall_ids"]:
                exported[wall_id] = mesh.visual.material.name
    assert exported == {
        data["walls"][0]["id"]: f"墙面_素材_{first}",
        data["walls"][1]["id"]: f"墙面_素材_{second}",
    }
    assert data["walls"][2]["wall_material"] is None
    assert data["openings"][0]["offset"] == original["openings"][0]["offset"]


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
    assert Room.model_validate({**room, "floor_material": "color:#739ac4"}).floor_material == "color:#739ac4"
    for invalid in ["color:red", "color:#123", "color:#zzzzzz", "color:#123456\n"]:
        with pytest.raises(ValidationError):
            Room.model_validate({**room, "floor_material": invalid})
        with pytest.raises(ValueError):
            floor_material(invalid)


@pytest.mark.parametrize("bedroom_material", ["charcoal", "color:#739ac4", "floor-herringbone", "floor-ivory-tile", "floor-travertine", "floor-light-oak", "floor-marble-tile"])
def test_different_room_floors_survive_real_glb_export(tmp_path, bedroom_material):
    data = layout_data()
    def polygon(x0, x1):
        return [{"x": x, "y": y} for x, y in [(x0, 0), (x1, 0), (x1, 6), (x0, 6)]]
    data["rooms"] = [
        {"id": "living", "name": "客厅", "kind": "living", "polygon": polygon(0, 4), "floor_material": "honey"},
        {"id": "bedroom", "name": "卧室", "kind": "bedroom", "polygon": polygon(4, 8), "floor_material": bedroom_material},
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
    assert exported["bedroom"].name == f"地板_素材_{bedroom_material}"
    assert exported["bedroom"].baseColorFactor.tolist() == floor_material(bedroom_material).baseColorFactor.tolist()
    assert exported["living"].baseColorTexture is not None
    assert (exported["bedroom"].baseColorTexture is not None) == bedroom_material.startswith("floor-")
    assert exported["bedroom"].roughnessFactor == pytest.approx(floor_material(bedroom_material).roughnessFactor)
    assert exported["living"].baseColorFactor.tolist() != exported["bedroom"].baseColorFactor.tolist()
