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
        assert not received
        assert client.post(url, json={"prompt": "room"}).status_code == 422
        assert client.post(url, data={"prompt": " "}, files=files).status_code == 422
        assert (
            client.post(
                url,
                data={"prompt": "午后", "context": '{"exterior":"custom"}'},
                files=files,
            ).status_code
            == 422
        )
        assert (
            client.post(url, data={"prompt": "x" * 1201}, files=files).status_code
            == 422
        )
        assert (
            client.post(
                url, data={"prompt": "room", "path": "private.png"}, files=files
            ).status_code
            == 422
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
        context = {
            "roomName": "客厅",
            "framing": "walkthrough",
            "lighting": "sunset",
            "exterior": "custom",
            "exteriorDescription": "窗外有远处的湖岸",
        }
        response = client.post(
            url,
            data={
                "prompt": "",
                "context": json.dumps(
                    {**context, "exteriorDescription": "  窗外有远处的湖岸  "}
                ),
            },
            files=files,
        )
        assert response.status_code == 202
        assert response.headers["cache-control"] == "no-store"
        record = response.json()
        assert record["status"] == "generating"
        assert record["prompt"] == ""
        assert record["context"]["framing"] == "walkthrough"
        assert record["context"]["exteriorDescription"] == "窗外有远处的湖岸"
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
    assert [json.loads(brief) for brief in received] == [
        {
            "sourceView": {
                "roomName": "客厅",
                "framing": "walkthrough",
                "lighting": "sunset",
            },
            "visualBrief": "",
            "exteriorBrief": "窗外有远处的湖岸",
        }
    ]


def test_image_brief_distinguishes_explicit_exterior_from_automatic():
    visual = "午后阳光，窗外是树木"
    automatic = json.loads(interior_image.compose_image_brief(visual, {}))
    assert automatic == {"sourceView": {}, "visualBrief": visual}
    selected = json.loads(
        interior_image.compose_image_brief(visual, {"exterior": "city"})
    )
    assert selected["visualBrief"] == visual
    assert "city streetscape" in selected["exteriorBrief"]


def test_panorama_preserves_landmarks_and_requires_equirectangular_input():
    landmark = {"label": "客厅沙发", "x": 75}
    context = interior_image.ImageContext(
        framing="panorama", roomId="living", landmarks=[landmark], heading=60
    ).model_dump(exclude_none=True)
    assert context["roomId"] == "living"
    brief = json.loads(interior_image.compose_image_brief("自然光", context))
    assert brief["furnitureLandmarks"] == [landmark]
    assert "heading" not in brief["sourceView"]
    assert "roomId" not in brief["sourceView"]
    standard = interior_image.ImageContext(
        roomId="living", landmarks=[landmark], heading=60
    )
    assert standard.roomId is None
    assert standard.landmarks is None and standard.heading is None

    wide, ordinary = io.BytesIO(), io.BytesIO()
    Image.new("RGB", (40, 20)).save(wide, format="JPEG")
    Image.new("RGB", (40, 30)).save(ordinary, format="JPEG")
    with Image.open(
        io.BytesIO(interior_image.normalize_view(wide.getvalue(), panorama=True))
    ) as image:
        assert image.size == (40, 20)
    with pytest.raises(ValueError, match="2:1"):
        interior_image.normalize_view(ordinary.getvalue(), panorama=True)


def post_panorama_batch(client, *rooms):
    view = io.BytesIO()
    Image.new("RGB", (40, 20), "white").save(view, format="JPEG")
    multipart = [("prompt", (None, "自然光"))]
    for name in rooms:
        multipart.extend(
            [
                (
                    "context",
                    (
                        None,
                        json.dumps(
                            {
                                "framing": "panorama",
                                "projectId": "sample",
                                "roomId": name,
                                "roomName": name,
                                "rotation": 25,
                                "exterior": "city",
                            }
                        ),
                    ),
                ),
                ("view", ("view.jpg", view.getvalue(), "image/jpeg")),
            ]
        )
    return client.post("/api/interior-images/batch", files=multipart)


def wait_for_gallery(client, condition):
    for _ in range(120):
        items = client.get("/api/interior-images").json()["items"]
        if condition(items):
            return items
        time.sleep(0.02)
    pytest.fail("gallery did not reach the expected state")


def test_batch_keeps_room_order_and_continues_after_a_failed_image(
    tmp_path, monkeypatch
):
    calls = []
    blocked = Event()
    png = io.BytesIO()
    Image.new("RGB", (40, 20), "white").save(png, format="PNG")

    async def generate(client, brief, reference, *, panorama):
        assert panorama
        data = json.loads(brief)
        assert "city streetscape" in data["exteriorBrief"]
        name = data["sourceView"]["roomName"]
        calls.append(name)
        if name == "living":
            await asyncio.to_thread(blocked.wait, 3)
            raise TimeoutError
        return png.getvalue()

    monkeypatch.setattr(interior_image, "generate_interior_png", generate)
    with TestClient(
        app_for(tmp_path, FakeCodex()), client=("127.0.0.1", 1234)
    ) as client:
        try:
            assert post_panorama_batch(client, "living", "living").status_code == 422
            response = post_panorama_batch(client, "living", "bedroom", "bath")
            assert response.status_code == 202
            records = response.json()["items"]
            assert [r["status"] for r in records] == ["generating", "queued", "queued"]
            assert {record["context"]["rotation"] for record in records} == {25}
            assert not post_panorama_batch(client, "living", "bedroom").json()["items"]
            batch_id = records[0]["batch_id"]
            assert (
                client.post(
                    f"/api/interior-images/{records[2]['id']}/cancel"
                ).status_code
                == 200
            )
        finally:
            blocked.set()
        final = wait_for_gallery(
            client,
            lambda items: (
                not any(i["status"] in {"generating", "queued"} for i in items)
            ),
        )
        assert {i["context"]["roomId"]: i["status"] for i in final} == {
            "living": "failed",
            "bedroom": "ready",
            "bath": "failed",
        }
        assert calls == ["living", "bedroom"]
        assert (
            client.post(f"/api/interior-images/batches/{batch_id}/cancel").status_code
            == 200
        )
        assert not post_panorama_batch(client, "bedroom").json()["items"]


def test_batch_can_stop_waiting_rooms_and_restores_saved_queue(tmp_path, monkeypatch):
    calls = []
    release = asyncio.Event()
    png = io.BytesIO()
    Image.new("RGB", (40, 20), "white").save(png, format="PNG")

    async def generate(client, brief, reference, *, panorama):
        name = json.loads(brief)["sourceView"]["roomName"]
        calls.append(name)
        if name == "living":
            await release.wait()
        return png.getvalue()

    monkeypatch.setattr(interior_image, "generate_interior_png", generate)
    with TestClient(
        app_for(tmp_path, FakeCodex()), client=("127.0.0.1", 1234)
    ) as client:
        records = post_panorama_batch(client, "living", "bedroom").json()["items"]
        stop = post_panorama_batch(client, "bath", "entry").json()["items"]
        assert [i["status"] for i in stop] == ["queued", "queued"]
        assert (
            client.post(
                f"/api/interior-images/batches/{stop[0]['batch_id']}/cancel"
            ).status_code
            == 200
        )
        assert (
            client.get("/api/interior-images").json()["items"][-1]["status"]
            == "generating"
        )
        assert records[1]["status"] == "queued"

    with TestClient(
        app_for(tmp_path, FakeCodex()), client=("127.0.0.1", 1234)
    ) as restarted:
        final = wait_for_gallery(
            restarted, lambda items: any(i["status"] == "ready" for i in items)
        )
    assert {i["context"]["roomId"]: i["status"] for i in final} == {
        "living": "failed",
        "bedroom": "ready",
        "bath": "failed",
        "entry": "failed",
    }
    assert calls == ["living", "bedroom"]


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
