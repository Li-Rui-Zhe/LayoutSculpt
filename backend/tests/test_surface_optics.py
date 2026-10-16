import io
import json
import struct

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.glb_builder import Builder
from backend.app.schemas import Layout
from backend.app.surface_design import SurfaceDesign, embedded_design
from backend.app.surface_optics import SurfaceOptics
from backend.app.surface_parametric import MaterialParameters
from backend.tests.test_surface_creation import wait_surface
from backend.tests.test_surface_parametric import parameters
from backend.tests.test_surface_studio import recipe
from backend.tests.test_workflow import FakeCodex, app_for, layout_data


def test_glass_generates_saves_reopens_and_exports_real_transmission(tmp_path):
    class GlassCodex(FakeCodex):
        async def generate(self, **kwargs):
            assert kwargs["image"] is None
            assert "玻璃" in kwargs["instructions"]
            return json.dumps(
                {
                    **parameters(),
                    "kind": "glass",
                    "name": "高光玻璃",
                    "roughness": 0.03,
                    "color": "#f5fbfa",
                }
            )

    with TestClient(app_for(tmp_path, GlassCodex())) as client:
        response = client.post(
            "/api/materials/generations",
            json={"category": "walls", "prompt": "高光玻璃"},
        )
        job = wait_surface(client, response.json()["id"])
        assert job["status"] == "succeeded", job
        source = job["result"]
        assert source["optics"]["transmission"] == 0.95
        saved = client.post(
            "/api/materials/design",
            json={
                **recipe("walls"),
                "base_id": source["id"],
                "color": "#ffffff",
                "roughness": source["roughness"],
                "optics": source["optics"],
                "origin": "ai",
            },
        ).json()
        assert saved["finish"] == "通透高光"
        path = tmp_path / "materials" / (saved["id"].split(":")[1] + ".png")
        assert embedded_design(path).optics.transmission == 0.95
        reopened = client.post(
            "/api/materials/preview", json={**saved["recipe"], "base_id": saved["id"]}
        )
        assert reopened.status_code == 200
        assert (
            json.loads(Image.open(io.BytesIO(reopened.content)).info["surface_design"])[
                "optics"
            ]["ior"]
            == 1.5
        )
        document = layout_data()
        document["walls"][0]["wall_material"] = saved["id"]
        document = Layout.model_validate(document).model_dump()
        document.update(style="natural", furniture_mode="basic", furniture=[])
        output = tmp_path / "export"
        Builder(document, Settings().furniture_catalog, tmp_path / "library").build(
            output
        )
        data = (output / "model.glb").read_bytes()
        length = struct.unpack_from("<I", data, 12)[0]
        tree = json.loads(data[20 : 20 + length])
        glass = next(m for m in tree["materials"] if saved["id"] in m.get("name", ""))
        assert glass["pbrMetallicRoughness"]["roughnessFactor"] == pytest.approx(0.03)
        assert (
            glass["extensions"]["KHR_materials_transmission"]["transmissionFactor"]
            == 0.95
        )
        assert glass["extensions"]["KHR_materials_volume"]["thicknessFactor"] == 0.01
        assert "KHR_materials_ior" in tree["extensionsUsed"]
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        stored = next(
            m
            for m in client.get("/api/materials/custom").json()["items"]
            if m["id"] == saved["id"]
        )
        assert stored["optics"] == source["optics"]


@pytest.mark.parametrize(
    "patch",
    [
        {"transmission": 1.1},
        {"ior": 0.5},
        {"thickness": -1},
        {"metalness": float("nan")},
    ],
)
def test_optics_bounds(patch):
    with pytest.raises(ValidationError):
        SurfaceOptics(**patch)


def test_backpaint_and_frosted_glass_and_legacy_defaults():
    assert SurfaceDesign(**recipe()).optics is None
    assert (
        MaterialParameters(**{**parameters(), "kind": "glass"}).optics.transmission
        == 0.95
    )
    opaque = MaterialParameters(
        **{**parameters(), "kind": "glass", "optics": {"transmission": 0}}
    )
    assert opaque.optics.transmission == 0
    frosted = MaterialParameters(**{**parameters(), "kind": "glass", "roughness": 0.5})
    assert frosted.roughness == 0.5 and frosted.optics.transmission > 0
    assert MaterialParameters(**{**parameters(), "kind": "metal"}).optics.metalness == 1
