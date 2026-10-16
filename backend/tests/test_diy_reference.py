from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.tests.test_diy import DiyCodex, design_data, wait_asset
from backend.tests.test_workflow import app_for


def picture():
    output = BytesIO()
    Image.new("RGBA", (120, 240), (180, 130, 80, 180)).save(output, "PNG")
    return output.getvalue()


def upload(client):
    response = client.post(
        "/api/diy/references", files={"file": ("chair.png", picture(), "image/png")}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_reference_image_reaches_codex_and_survives_reopen(tmp_path):
    codex = DiyCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        ref = upload(client)
        assert (ref["width"], ref["height"]) == (120, 240)
        normalized = client.get(ref["url"]).content
        assert Image.open(BytesIO(normalized)).size == (120, 240)
        assert upload(client)["id"] == ref["id"]
        response = client.post(
            "/api/diy/generate",
            json={
                "reference_id": ref["id"],
                "model": "test-chosen",
                "reasoning_effort": "high",
            },
        )
        assert response.status_code == 202, response.text
        asset = wait_asset(client, response.json()["id"])
        assert asset["status"] == "ready", asset
        assert asset["request"]["reference_id"] == ref["id"]
        assert len(codex.calls) == 2
        for call in codex.calls:
            assert call["image"] == tmp_path / "diy" / asset["id"] / "reference.png"
            assert call["image"].read_bytes() == normalized
            assert call["model"] == "test-chosen"
            assert call["reasoning_effort"] == "high"
        assert (
            client.get(f"/api/diy/assets/{asset['id']}/model.glb").content[:4]
            == b"glTF"
        )
        saved = client.post(
            f"/api/diy/assets/{asset['id']}/save",
            json={"design": asset["design"], "revision": asset["revision"]},
        ).json()
        assert saved["request"]["reference_id"] == ref["id"]


def test_image_requires_vision_model_and_invalid_reference_creates_no_task(tmp_path):
    codex = DiyCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        ref = upload(client)
        for body in [
            {"reference_id": ref["id"], "model": "text-only"},
            {"reference_id": "a" * 64, "prompt": "桌子"},
            {"reference_id": "../../private", "prompt": "桌子"},
            {"prompt": "  "},
        ]:
            assert client.post("/api/diy/generate", json=body).status_code == 422
        assert not client.get("/api/diy/assets").json()["items"]
        assert not codex.calls


def test_reference_can_modify_existing_design(tmp_path):
    codex = DiyCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        ref = upload(client)
        base = design_data()
        response = client.post(
            "/api/diy/generate",
            json={
                "prompt": "参考图片修改桌面",
                "reference_id": ref["id"],
                "base": base,
                "target_part_id": "top",
                "preserve_dimensions": True,
            },
        )
        assert response.status_code == 202
        asset = wait_asset(client, response.json()["id"])
        assert asset["status"] == "ready"
        assert asset["design"]["parts"][1] == base["parts"][1]
        assert codex.calls[-1]["image"] is not None


@pytest.mark.parametrize(
    "content,status",
    [
        (b"not an image", 422),
        (b"x" * (10 * 1024 * 1024 + 1), 413),
        (b'<svg xmlns="http://www.w3.org/2000/svg"/>', 422),
    ],
    ids=["invalid-image", "too-large", "svg"],
)
def test_bad_upload_is_rejected(tmp_path, content, status):
    with TestClient(app_for(tmp_path, DiyCodex())) as client:
        assert (
            client.post(
                "/api/diy/references",
                files={"file": ("fake.png", content, "image/png")},
            ).status_code
            == status
        )
        assert not (tmp_path / "diy_references").exists()


def test_reference_long_side_resize_without_cropping(tmp_path):
    output = BytesIO()
    Image.new("RGB", (3000, 1500), "white").save(output, "JPEG")
    with TestClient(app_for(tmp_path, DiyCodex())) as client:
        result = client.post(
            "/api/diy/references",
            files={"file": ("wide.jpg", output.getvalue(), "image/jpeg")},
        ).json()
        assert (result["width"], result["height"]) == (2048, 1024)
