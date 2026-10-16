import hashlib
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.config import Settings
from backend.app.diy_geometry import design_glb
from backend.app.diy_schema import FURNITURE_MATERIALS, DiyDesign
from backend.app.glb_builder import Builder
from backend.app.library_models import load_glb
from backend.app.schemas import Layout
from backend.app.surface_materials import surface_material
from backend.tests.test_workflow import (
    FakeCodex,
    app_for,
    image_bytes,
    layout_data,
    wait_job,
)


def recipe(category="floor"):
    return dict(
        name="浅木通铺",
        category=category,
        base_id="floor-oak" if category == "floor" else "wall-oak",
        color="#dac8aa",
        repeat=2,
        rotation=90,
        roughness=0.45,
        origin="preset",
    )


def test_surface_preview_save_reopen_and_actual_model(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        preview = client.post("/api/materials/preview", json=recipe())
        assert preview.status_code == 200
        assert Image.open(io.BytesIO(preview.content)).size == (720, 720)
        saved = client.post("/api/materials/design", json=recipe())
        assert saved.status_code == 201, saved.text
        item = saved.json()
        assert item["id"] == "texture:" + hashlib.sha256(preview.content).hexdigest()
        assert item["categories"] == ["floor"]
        assert item["recipe"] == recipe()
        assert (
            client.post("/api/materials/design", json=recipe()).json()["id"]
            == item["id"]
        )
        changed = client.post(
            "/api/materials/design", json={**recipe(), "roughness": 0.95}
        ).json()
        assert changed["id"] != item["id"]
        material = surface_material(item["id"], "floor", tmp_path / "materials")
        assert material.roughnessFactor == 0.45
        assert material.baseColorTexture is not None
        # 不依赖前端缓存，重新加载服务仍然能获取完整配方。
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        items = client.get("/api/materials/custom").json()["items"]
        assert next(i for i in items if i["id"] == item["id"])["recipe"] == recipe()
        layout = layout_data()
        layout["rooms"][0]["floor_material"] = item["id"]
        document = Layout.model_validate(layout).model_dump()
        document.update(style="natural", furniture_mode="basic", furniture=[])
        folder = tmp_path / "actual-glb"
        folder.mkdir()
        Builder(document, Settings().furniture_catalog, tmp_path / "library").build(
            folder
        )
        scene = load_glb((folder / "model.glb").read_bytes())
        matching = [
            m.visual.material
            for m in scene.geometry.values()
            if item["id"] in m.visual.material.name
        ]
        assert matching and all(m.roughnessFactor == 0.45 for m in matching)


@pytest.mark.parametrize(
    "patch",
    [
        {"category": "fabric"},
        {"base_id": "wall-matte"},
        {"repeat": 0},
        {"repeat": 7},
        {"rotation": 45},
        {"color": "invalid"},
        {"name": "  "},
        {"roughness": 2},
        {"base_id": "../../secret"},
    ],
)
def test_surface_recipe_validation(tmp_path, patch):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        response = client.post("/api/materials/design", json={**recipe(), **patch})
        assert response.status_code == 422
        assert not list((tmp_path / "materials").glob("*.png"))


def test_generated_job_uses_selected_materials(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        floor = client.post("/api/materials/design", json=recipe()).json()["id"]
        wall = client.post("/api/materials/design", json=recipe("walls")).json()["id"]

        def upload(**options):
            return client.post(
                "/api/jobs",
                files={"file": ("plan.png", image_bytes(), "image/png")},
                data={"collaboration": "false", **options},
            )

        assert upload(wall_material=floor).status_code == 422
        assert upload(floor_material="texture:" + "0" * 64).status_code == 422
        response = upload(floor_material=floor, wall_material=wall)
        assert response.status_code == 201, response.text
        job = wait_job(client, response.json()["id"])
        assert job["status"] == "succeeded", job
        layout = client.get(job["result"]["layout_url"]).json()
        assert all(r["floor_material"] == floor for r in layout["rooms"])
        assert all(w["wall_material"] == wall for w in layout["walls"])
        assert job["options"]["floor_material"] == floor


def test_furniture_finishes_are_separate_and_exportable():
    assert {m["family"] for m in FURNITURE_MATERIALS.values()} == {
        "木材",
        "布艺",
        "皮革",
        "金属",
        "玻璃",
        "台面石材",
    }
    assert not any(
        "地板" in m["name"] or "墙" in m["name"] for m in FURNITURE_MATERIALS.values()
    )
    for identifier, item in FURNITURE_MATERIALS.items():
        design = DiyDesign.model_validate(
            dict(
                name="家具饰面验证",
                category="furniture",
                parts=[
                    dict(
                        id="p",
                        name="部件",
                        shape="box",
                        x=0,
                        y=0,
                        z=0,
                        width=1,
                        depth=0.1,
                        height=1,
                        rotation=0,
                        color=item["color"],
                        roughness=item["roughness"],
                        metallic=item["metallic"],
                        material_id=identifier,
                    )
                ],
            )
        )
        scene = load_glb(design_glb(design))
        mat = next(iter(scene.geometry.values())).visual.material
        assert mat.metallicFactor == pytest.approx(item["metallic"])
        if item["opacity"] < 1:
            assert mat.alphaMode == "BLEND" and mat.baseColorFactor[3] < 255
