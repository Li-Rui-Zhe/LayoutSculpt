import asyncio
import io
import json
import sqlite3

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from backend.app.surface_parametric import MaterialParameters, render_parameters
from backend.tests.test_surface_creation import wait_surface
from backend.tests.test_surface_studio import recipe
from backend.tests.test_workflow import FakeCodex, app_for


def parameters(**patch):
    return dict(
        name="暖白哑光乳胶漆",
        kind="paint",
        color="#eee9df",
        accent="#eee9df",
        roughness=0.9,
        intensity=0,
        density=2,
        layout="straight",
        joint=0.01,
        note="暖白哑光饰面",
        **patch,
    )


class MaterialCodex(FakeCodex):
    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        return json.dumps(parameters(), ensure_ascii=False)


def test_default_material_uses_codex_without_image_service_and_saves(
    tmp_path, monkeypatch
):
    def no_image_service(*args, **kwargs):
        raise AssertionError("常规材质不得查询或调用生图服务")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", no_image_service)
    codex = MaterialCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        response = client.post(
            "/api/materials/generations",
            json={"category": "walls", "prompt": "暖白哑光乳胶漆"},
        )
        assert response.status_code == 202
        job = wait_surface(client, response.json()["id"])
        assert job["method"] == "parametric" and job["status"] == "succeeded"
        assert len(codex.calls) == 1 and codex.calls[0]["image"] is None
        assert "surface-material" in codex.calls[0]["instructions"]
        source = job["result"]
        assert source["roughness"] == 0.9
        image = Image.open(io.BytesIO(client.get(source["url"]).content))
        assert image.getpixel((100, 100)) == (238, 233, 223)
        result = client.post(
            "/api/materials/design",
            json={
                **recipe("walls"),
                "base_id": source["id"],
                "color": "#ffffff",
                "roughness": source["roughness"],
                "origin": "ai",
            },
        )
        assert result.status_code == 201 and result.json()["roughness"] == 0.9
        saved = result.json()
        assert any(
            item["id"] == saved["id"]
            for item in client.get("/api/materials/custom").json()["items"]
        )
        assert (
            client.post(
                "/api/materials/preview",
                json={**saved["recipe"], "base_id": saved["id"]},
            ).status_code
            == 200
        )


@pytest.mark.parametrize(
    "kind", ["paint", "plaster", "tiles", "wood", "terrazzo", "linen", "panel", "stone"]
)
def test_renderer_is_deterministic_and_tiles_without_border_jump(kind):
    spec = MaterialParameters(
        **{**parameters(), "kind": kind, "intensity": 0.6, "accent": "#c4bbaa"}
    )
    first = render_parameters(spec)
    assert first == render_parameters(spec)
    image = np.array(Image.open(io.BytesIO(first))).astype(float)
    assert image.shape == (1024, 1024, 3)
    if kind == "paint":
        assert np.max(image.std(axis=(0, 1))) == 0
    elif kind in {"plaster", "linen", "stone", "terrazzo"}:
        assert np.max(image.std(axis=(0, 1))) > 0.1
        assert np.abs(image[:, 0] - image[:, -1]).mean() < 6


@pytest.mark.parametrize("layout", ["straight", "brick", "herringbone"])
def test_wood_layouts_render(layout):
    spec = MaterialParameters(
        **{
            **parameters(),
            "kind": "wood",
            "layout": layout,
            "intensity": 0.8,
            "accent": "#706050",
        }
    )
    assert len(render_parameters(spec)) > 10000


@pytest.mark.parametrize(
    "patch",
    [
        {"density": 10000},
        {"color": "red"},
        {"roughness": float("nan")},
        {"layout": "herringbone"},
    ],
)
def test_invalid_parameters_rejected(patch):
    with pytest.raises(ValidationError):
        MaterialParameters(**{**parameters(), **patch})


@pytest.mark.parametrize("kind", ["unsupported", "private-model-response"])
def test_unsupported_and_malformed_do_not_save_or_leak_model_output(tmp_path, kind):
    class BadCodex(FakeCodex):
        async def generate(self, **kwargs):
            return json.dumps({**parameters(), "kind": kind})

    app = app_for(tmp_path, BadCodex())
    with TestClient(app) as client:
        result = client.post(
            "/api/materials/generations",
            json={"category": "walls", "prompt": "花卉壁画"},
        )
        job = wait_surface(client, result.json()["id"])
        assert job["status"] == "failed"
        assert "private-model-response" not in job["error"]
        assert "配方未完成" in job["error"]
        assert not job["result"]


def layer(pattern="fibers", **patch):
    return {
        "pattern": pattern,
        "color": "#e6d7bc",
        "opacity": 0.45,
        "scale_x": 140,
        "scale_y": 60,
        "detail": 0.7,
        "coverage": 0.55,
        "angle": 45,
        "blend": "mix",
        "seed": 42,
        **patch,
    }


def free_parameters(**patch):
    return {
        **parameters(),
        "kind": "羊毛地毯",
        "preset": None,
        "name": "米色羊毛短绒地毯",
        "color": "#baab91",
        "roughness": 0.95,
        "layers": [layer("noise", scale_x=12, scale_y=12), layer()],
        **patch,
    }


def test_open_material_generates_saves_and_preserves_recipe(tmp_path):
    class FreeCodex(FakeCodex):
        async def generate(self, **kwargs):
            self.calls.append(kwargs)
            return json.dumps(free_parameters())

    codex = FreeCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        response = client.post(
            "/api/materials/generations",
            json={"category": "floor", "prompt": "米色羊毛地毯地板"},
        )
        job = wait_surface(client, response.json()["id"], category="floor")
        assert job["status"] == "succeeded"
        assert len(codex.calls) == 1
        source = job["result"]
        image = Image.open(io.BytesIO(client.get(source["url"]).content))
        assert np.array(image).std(axis=(0, 1)).max() > 1
        assert json.loads(image.info["surface_parameters"])["kind"] == "羊毛地毯"
        result = client.post(
            "/api/materials/design",
            json={
                **recipe("floor"),
                "base_id": source["id"],
                "color": "#ffffff",
                "roughness": source["roughness"],
                "origin": "ai",
            },
        )
        assert result.status_code == 201
        saved = result.json()
        assert saved["roughness"] == 0.95
        path = tmp_path / "materials" / f"{saved['id'].split(':')[1]}.png"
        with Image.open(path) as exported:
            assert (
                json.loads(exported.info["surface_parameters"])["layers"]
                == source["parameters"]["layers"]
            )
        assert any(
            item["id"] == saved["id"]
            for item in client.get("/api/materials/custom").json()["items"]
        )
        preview = client.post(
            "/api/materials/preview", json={**saved["recipe"], "base_id": saved["id"]}
        )
        assert preview.status_code == 200
        assert "surface_parameters" in Image.open(io.BytesIO(preview.content)).info


def test_incomplete_new_material_is_repaired_once(tmp_path):
    class RepairCodex(FakeCodex):
        async def generate(self, **kwargs):
            self.calls.append(kwargs)
            return json.dumps(
                free_parameters(layers=[])
                if len(self.calls) == 1
                else free_parameters()
            )

    codex = RepairCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        response = client.post(
            "/api/materials/generations",
            json={"category": "floor", "prompt": "米色羊毛地毯"},
        )
        assert (
            wait_surface(client, response.json()["id"], category="floor")["status"]
            == "succeeded"
        )
        assert len(codex.calls) == 2


@pytest.mark.parametrize(
    "pattern",
    ["solid", "noise", "fibers", "weave", "speckles", "veins", "stripes", "grid"],
)
@pytest.mark.parametrize("angle", [0, 45, 90, 135])
def test_pattern_is_periodic_in_both_axes(pattern, angle):
    from backend.app.surface_patterns import TextureLayer, pattern_mask

    spec = TextureLayer(**layer(pattern, angle=angle, scale_x=15, scale_y=24))
    x = np.array([0.013, 0.17, 0.471, 0.819])
    y = np.array([0.241, 0.013, 0.762, 0.351])
    expected = pattern_mask(spec, x, y)
    np.testing.assert_allclose(expected, pattern_mask(spec, x + 1, y), atol=1e-10)
    np.testing.assert_allclose(expected, pattern_mask(spec, x, y + 1), atol=1e-10)
    assert np.isfinite(expected).all()


@pytest.mark.parametrize(
    "patch",
    [
        {"layers": [layer()] * 9},
        {"layers": [layer(scale_x=10000)]},
        {"layers": [layer(opacity=float("nan"))]},
        {"kind": "  "},
        {"layers": [layer(opacity=0)]},
    ],
)
def test_free_recipe_budget_and_numeric_validation(patch):
    with pytest.raises(ValidationError):
        MaterialParameters(**free_parameters(**patch))


def test_arbitrary_name_does_not_change_rendering_and_presets_still_work():
    first = MaterialParameters(**free_parameters())
    second = MaterialParameters(**free_parameters(kind="自定义复合肌理-未登记名称"))
    assert render_parameters(first) == render_parameters(second)
    glass = MaterialParameters(**free_parameters(kind="细纹艺术玻璃", preset="glass"))
    assert glass.optics.transmission == 0.95


def test_parametric_cancel_interrupts_codex_and_keeps_library(tmp_path):
    class SlowCodex(MaterialCodex):
        async def generate(self, **kwargs):
            self.calls.append(kwargs)
            await asyncio.sleep(60)

    codex = SlowCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        job = client.post(
            "/api/materials/generations",
            json={"category": "walls", "prompt": "暖白色乳胶漆"},
        ).json()
        second = client.post(
            "/api/materials/generations",
            json={"category": "walls", "prompt": "同用途重复请求"},
        )
        assert second.status_code == 409
        cancelled = client.post(f"/api/materials/generations/{job['id']}/cancel").json()
        assert cancelled["status"] == "cancelled" and cancelled["result"] is None
        assert client.get("/api/materials/custom").json()["items"] == []


def test_reference_requires_explicit_image_mode(tmp_path):
    with TestClient(app_for(tmp_path, MaterialCodex())) as client:
        result = client.post(
            "/api/materials/generations",
            json={
                "category": "walls",
                "prompt": "暖白乳胶漆",
                "reference_id": "source:" + "a" * 64,
            },
        )
        assert result.status_code == 422


def test_existing_generation_table_migrates_as_image(tmp_path):
    app = app_for(tmp_path, MaterialCodex())
    service = app.state.surface_generations
    with sqlite3.connect(service.settings.db_path) as db:
        db.execute(
            "CREATE TABLE surface_generations (id TEXT PRIMARY KEY, category TEXT, prompt TEXT, status TEXT, result TEXT, error TEXT, created_at TEXT, updated_at TEXT)"
        )
        db.execute(
            "INSERT INTO surface_generations VALUES('old','walls','旧生图','failed',NULL,'旧错误','2026','2026')"
        )
    with TestClient(app):
        rows = asyncio.run(service.rows())
        assert (
            rows[0]["method"] == "image"
            and rows[0]["error"] == "材质生成未完成，请调整描述后重试；现有设计已保留。"
        )
