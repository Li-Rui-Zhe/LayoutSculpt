"""验证官方家庭系列的索引、真实模型和放置后具体变体保留。"""

import hashlib
import json
import asyncio

import pytest
import numpy as np
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.glb_builder import Builder
from backend.app.library_models import load_glb
from backend.app.library import LibraryService
from backend.app.schemas import Furniture, Layout
from backend.tests.test_workflow import FakeCodex, app_for, layout_data

CATALOG = Settings().furniture_catalog


@pytest.mark.parametrize(
    "key",
    [
        "sofa",
        "sofa_compact",
        "sofa_modular",
        "sofa_daybed",
        "sofa_chaise_left",
        "sofa_chaise_right",
    ],
)
def test_sofa_feet_touch_their_actual_bases(key):
    scene = load_glb((CATALOG.parent / "glb" / f"{key}.glb").read_bytes())
    bases, feet = [], []
    for node in scene.graph.nodes_geometry:
        transform, name = scene.graph[node]
        mesh = scene.geometry[name].copy()
        mesh.apply_transform(transform)
        if "底座" in name or "贵妃承托" in name:
            bases.append(mesh.bounds)
        if "支脚" in name:
            top = mesh.vertices[mesh.vertices[:, 1] > mesh.bounds[1, 1] - 0.006].mean(
                axis=0
            )
            feet.append(top)
    assert len(feet) >= 4
    for top in feet:
        assert any(
            np.all(top >= bounds[0] - 0.015) and np.all(top <= bounds[1] + 0.015)
            for bounds in bases
        ), (key, top)


def test_daybed_has_a_continuous_unobstructed_lounging_surface():
    scene = load_glb((CATALOG.parent / "glb" / "sofa_daybed.glb").read_bytes())
    mattress, frame = [], []
    for node in scene.graph.nodes_geometry:
        transform, name = scene.graph[node]
        mesh = scene.geometry[name].copy()
        mesh.apply_transform(transform)
        if "躺卧软垫" in name:
            mattress.append(mesh.bounds)
        if any(term in name for term in ("立柱", "木条", "扶手")):
            frame.append(mesh.bounds)
    assert len(mattress) == 1, "日床应有连续躺卧面，不能沿用分段沙发坐垫"
    bounds = mattress[0]
    assert bounds[1, 0] - bounds[0, 0] >= 1.90
    assert bounds[1, 2] - bounds[0, 2] >= 0.80
    for part in frame:
        if part[1, 1] > bounds[1, 1]:
            overlap = np.minimum(part[1, [0, 2]], bounds[1, [0, 2]]) - np.maximum(
                part[0, [0, 2]], bounds[0, [0, 2]]
            )
            assert not np.all(overlap > 0.003), "围框不能侵入躺卧面"


def test_catalog_categories_variants_and_files_are_consistent():
    entries = json.loads(CATALOG.read_text(encoding="utf-8"))["items"]
    assert len(entries) == 83
    assert len({e["id"] for e in entries}) == len(entries)
    assert len({e["kind"] for e in entries}) == len(entries)
    assert {e["category"] for e in entries} == set(
        "客厅 卧室 餐厅 书房 儿童房 玄关 厨房 卫浴 阳台 装饰".split()
    )
    assert {
        "sofa_chaise_left",
        "sofa_chaise_right",
        "crib",
        "bed_bunk",
        "office_chair",
        "desk_corner",
        "laundry_tower",
        "floor_mirror",
        "wardrobe_sliding",
        "drying_rack_single",
        "desktop_computer",
        "laptop",
    } <= {e["kind"] for e in entries}
    signatures = []
    for entry in entries:
        assert all(
            entry.get(k)
            for k in ["family", "variant", "style", "tags", "rooms", "description"]
        )
        assert entry["category"] in entry["rooms"]
        data = (CATALOG.parent / "glb" / f"{entry['kind']}.glb").read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if entry.get("sha256"):
            assert digest == entry["sha256"]
        signatures.append(digest)
    assert len(set(signatures)) == len(signatures), "不能用重复文件充当不同款式"


def test_variant_selection_places_exact_model_and_rebuilds(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        items = client.get("/api/library/assets").json()["items"]
        chosen = []
        for key in [
            "sofa_chaise_left",
            "sofa_chaise_right",
            "floor_mirror",
            "bed_bunk",
            "office_chair",
            "laundry_tower",
        ]:
            item = next(i for i in items if i.get("catalog_kind") == key)
            assert item["source"] == "builtin" and item["family"] and item["variant"]
            assert item["description"] and item["thumbnail_url"]
            response = client.post("/api/library/placement", json={"id": item["id"]})
            assert response.status_code == 200, response.text
            template = response.json()
            Furniture.model_validate(template)
            assert template["name"] == item["name"]
            assert [template[k] for k in ["width", "depth", "height"]] == pytest.approx(
                item["dimensions"], abs=1e-5
            )
            assert template["kind"] == item["furniture_kind"]
            chosen.append(template)
        assert chosen[0]["asset_id"] != chosen[1]["asset_id"]
        layout = Layout.model_validate(layout_data()).model_dump()
        layout.update(style="natural", furniture_mode="library", furniture=[chosen[0]])
        config = client.app.state.settings
        output = tmp_path / "rebuild"
        output.mkdir()
        Builder(layout, CATALOG, config.data_dir / "library").build(output)
        report = json.loads(
            (output / "furniture-report.json").read_text(encoding="utf-8")
        )
        assert report["fallback"] == []
        assert report["instances"][0]["asset_id"] == chosen[0]["asset_id"]
        assert load_glb((output / "model.glb").read_bytes()).geometry


@pytest.mark.parametrize(
    "key,rail_count", [("drying_rack", 2), ("drying_rack_single", 1)]
)
def test_hanging_racks_have_high_full_width_rails(key, rail_count):
    scene = load_glb((CATALOG.parent / "glb" / f"{key}.glb").read_bytes())
    rails = []
    for node in scene.graph.nodes_geometry:
        transform, name = scene.graph[node]
        if "挂衣横" in name:
            mesh = scene.geometry[name].copy()
            mesh.apply_transform(transform)
            rails.append(mesh.bounds)
    assert len(rails) == rail_count
    for bounds in rails:
        assert bounds[0, 1] > 1.5, "挂衣横杆必须足够高，可悬挂长衣"
        assert bounds[1, 0] - bounds[0, 0] > 1.45
    assert not any("翼板" in name for name in scene.geometry)


@pytest.mark.parametrize(
    "key,elevation",
    [
        ("drying_rack", 0),
        ("drying_rack_single", 0),
        ("desktop_computer", 0.75),
        ("laptop", 0.75),
        ("sofa_daybed", 0),
    ],
)
def test_asset_download_placement_and_real_rebuild(tmp_path, key, elevation):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        item = next(
            i
            for i in client.get("/api/library/assets").json()["items"]
            if i.get("catalog_kind") == key
        )
        assert client.get(item["thumbnail_url"]).content.startswith(b"\x89PNG")
        assert client.get(item["model_url"]).content.startswith(b"glTF")
        response = client.post("/api/library/placement", json={"id": item["id"]})
        assert response.status_code == 200, response.text
        template = response.json()
        assert template["elevation"] == elevation
        assert [template[k] for k in ["width", "depth", "height"]] == pytest.approx(
            item["dimensions"]
        )
        settings = client.app.state.settings
        service = LibraryService(settings, client.app.state.store, client.app.state.diy)
        catalog_item = next(
            i for i in asyncio.run(service.catalog()) if i["asset_id"] == item["id"]
        )
        assert catalog_item["default_elevation"] == elevation
        template.update(room_id="living", x=2, y=2)
        layout = Layout.model_validate(layout_data()).model_dump()
        layout.update(style="natural", furniture_mode="library", furniture=[template])
        output = tmp_path / "rebuilt"
        output.mkdir()
        Builder(layout, CATALOG, settings.data_dir / "library").build(output)
        report = json.loads(
            (output / "furniture-report.json").read_text(encoding="utf-8")
        )
        assert report["fallback"] == []
        assert report["instances"][0]["asset_id"] == template["asset_id"]
        scene = load_glb((output / "model.glb").read_bytes())
        furniture_bounds = []
        for node in scene.graph.nodes_geometry:
            transform, name = scene.graph[node]
            if name.startswith(f"library_{template['asset_id'].split(':')[1]}_"):
                mesh = scene.geometry[name].copy()
                mesh.apply_transform(transform)
                furniture_bounds.append(mesh.bounds)
        assert furniture_bounds
        assert min(b[0, 1] for b in furniture_bounds) == pytest.approx(
            elevation + 0.035, abs=1e-5
        )
        if key in {"desktop_computer", "laptop"}:
            materials = {
                mesh.visual.material.name: mesh.visual.material
                for name, mesh in scene.geometry.items()
                if name.startswith("library_")
            }
            for name in ["电脑_内嵌高清屏幕", "电脑_键帽字标"]:
                assert materials[name].baseColorTexture is not None
            if key == "desktop_computer":
                assert materials["电脑_烟灰侧透玻璃"].alphaMode == "BLEND"
