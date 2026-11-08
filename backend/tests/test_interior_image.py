import asyncio
import io
import json
import time
from threading import Event
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin

from backend.app import interior_image
from backend.tests.test_workflow import FakeCodex, app_for


def test_interior_image_accepts_only_a_local_view_and_prompt(tmp_path, monkeypatch):
    received = []
    release = Event()
    view = io.BytesIO()
    png = io.BytesIO()
    Image.new("RGB", (32, 24), "orange").save(png, format="PNG")
    Image.new("RGB", (20, 12), "orange").save(
        view, format="JPEG", exif=b"Exif\0\0synthetic"
    )
    files = {"view": ("view.jpg", view.getvalue(), "image/jpeg")}

    async def generate(client, prompt, reference):
        with Image.open(io.BytesIO(reference)) as image:
            assert image.size == (20, 12)
            assert "exif" not in image.info
            assert image.getpixel((0, 0)) == pytest.approx((255, 165, 0), abs=2)
        received.append(prompt)
        await asyncio.to_thread(release.wait, 5)
        return png.getvalue()

    monkeypatch.setattr(interior_image, "generate_interior_png", generate)
    app = app_for(tmp_path, FakeCodex())
    connection = app.state.ai_client.connections
    url = "/api/interior-image"
    with TestClient(app, client=("127.0.0.1", 12345)) as client:
        connection.data["default_provider"] = "deepseek"
        denied = client.post(url, data={"prompt": "room"}, files=files)
        assert denied.status_code == 409
        assert "DeepSeek API 暂未接入" in denied.json()["detail"]
        assert not received
        connection.data["default_provider"] = "codex"
        assert client.post(url, json={"prompt": "room"}).status_code == 422
        assert client.post(url, data={"prompt": " "}, files=files).status_code == 422
        assert (
            client.post(url, data={"prompt": "x" * 1201}, files=files).status_code
            == 422
        )
        assert (
            client.post(
                url, data={"prompt": "room", "path": "private.png"}, files=files
            ).status_code
            == 400
        )
        assert (
            client.post(
                url,
                data={"prompt": "room"},
                files={"view": ("view.jpg", b"bad", "image/jpeg")},
            ).status_code
            == 422
        )
        assert (
            client.post(
                url,
                data={"prompt": "room"},
                files=files,
                headers={"Origin": "https://other.test"},
            ).status_code
            == 403
        )
        response = client.post(url, data={"prompt": "  虚构客厅  "}, files=files)
        assert response.status_code == 202
        assert response.headers["cache-control"] == "no-store"
        record = response.json()
        assert record["status"] == "generating"
        assert record["prompt"] == "虚构客厅"
        assert client.get("/api/interior-images").json()["items"] == [record]
        assert client.post(url, data={"prompt": "room"}, files=files).status_code == 409
        release.set()
        for _ in range(50):
            ready = client.get("/api/interior-images").json()["items"][0]
            if ready["status"] == "ready":
                break
            time.sleep(0.02)
        assert ready["status"] == "ready"
        assert client.get(ready["image_url"]).content == png.getvalue()
        assert client.get(ready["view_url"]).headers["content-type"] == "image/jpeg"
        assert client.get(ready["thumbnail_url"]).status_code == 200
        assert (
            client.get(f"/api/interior-images/{ready['id']}/record.json").status_code
            == 404
        )
        assert (
            client.get("/api/interior-images/not-an-id/result.png").status_code == 404
        )
    with TestClient(app, client=("192.0.2.10", 12345)) as client:
        assert client.post(url, data={"prompt": "room"}, files=files).status_code == 403
        assert client.get("/api/interior-images").status_code == 403
        assert client.get(ready["image_url"]).status_code == 403
    restored = app_for(tmp_path, FakeCodex())
    restored.state.ai_client.connections.data["default_provider"] = "deepseek"
    with TestClient(restored, client=("127.0.0.1", 12345)) as client:
        history = client.get("/api/interior-images").json()
        assert history["items"] == [ready]
        assert history["folder"] == str(tmp_path / "interior_images")
        assert client.get(ready["image_url"]).content == png.getvalue()
    assert received == ["虚构客厅"]


def test_generated_png_uses_thread_directory_and_strips_metadata(tmp_path):
    thread = str(uuid4())
    output = tmp_path / thread
    output.mkdir()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("test", "do not return")
    Image.new("RGB", (16, 16), "orange").save(
        output / "generated.png", pnginfo=metadata
    )
    stdout = json.dumps({"type": "thread.started", "thread_id": thread}).encode()

    with Image.open(
        io.BytesIO(interior_image.generated_png(stdout, tmp_path.resolve()))
    ) as image:
        assert image.size == (16, 16)
        assert image.getpixel((0, 0)) == (255, 165, 0)
        assert not image.info

    with pytest.raises(ValueError):
        interior_image.generated_png(
            b'{"type":"thread.started","thread_id":"../private"}', tmp_path
        )
