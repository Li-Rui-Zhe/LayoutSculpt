"""验证官方家庭系列的索引、真实模型和放置后具体变体保留。"""

import hashlib
import json

import pytest
import numpy as np
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.glb_builder import Builder
from backend.app.library_models import load_glb
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


def test_catalog_categories_variants_and_files_are_consistent():
    entries = json.loads(CATALOG.read_text(encoding="utf-8"))["items"]
    assert len(entries) == 80
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
