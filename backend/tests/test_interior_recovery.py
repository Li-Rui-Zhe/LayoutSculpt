import asyncio
import io
import json
import time

from fastapi.testclient import TestClient
from PIL import Image

from backend.app import interior_image
from backend.app.schemas import Furniture, Furnishing, Layout
from backend.app.usability import access_issues
from backend.tests.test_workflow import FakeCodex, app_for, layout_data


def view_file():
    view = io.BytesIO()
    Image.new("RGB", (24, 16), "beige").save(view, format="JPEG")
    return {"view": ("view.jpg", view.getvalue(), "image/jpeg")}


def test_cancel_archive_restore_and_provider_isolation(tmp_path, monkeypatch):
    cancelled = []

    async def generate(*args):
        try:
            await asyncio.sleep(60)
        finally:
            cancelled.append(True)

    monkeypatch.setattr(interior_image, "generate_interior_png", generate)
    app = app_for(tmp_path, FakeCodex())
    app.state.ai_client.connections.data["default_provider"] = "deepseek"
    with TestClient(app, client=("127.0.0.1", 12345)) as client:
        context = {"projectId": "sample", "title": "测试之家", "roomName": "客厅"}
        result = client.post("/api/interior-image", data={"prompt": "下午自然光", "context": json.dumps(context)}, files=view_file())
        assert result.status_code == 202, result.text
        record = result.json()
        assert record["context"] == context
        assert app.state.ai_client.connections.data["default_provider"] == "deepseek"
        path = f"/api/interior-images/{record['id']}"
        assert client.post(path + "/archive", json={"archived": True}).status_code == 409
        assert client.post("/api/interior-image", data={"prompt": "another"}, files=view_file()).status_code == 409
        cancelled_record = client.post(path + "/cancel").json()
        assert cancelled_record["status"] == "failed"
        assert "已取消" in cancelled_record["error"]
        assert cancelled
        assert client.post(path + "/cancel").status_code == 200
        assert client.get(record["view_url"]).status_code == 200
        assert client.post(path + "/archive", json={"archived": True}).status_code == 200
        archived = client.get("/api/interior-images").json()["items"][0]
        assert archived["archived"] is True
        assert archived["context"] == context
        assert client.post(path + "/archive", json={"archived": False}).status_code == 200
        assert not client.get("/api/interior-images").json()["items"][0]["archived"]
        assert client.post(path + "/archive", json={"archived": "false"}).status_code == 422
        assert client.post("/api/interior-images/not-valid/cancel").status_code == 404


def test_failure_keeps_source_and_metadata_and_rejects_bad_context(tmp_path, monkeypatch):
    async def generate(*args):
        raise TimeoutError()
    monkeypatch.setattr(interior_image, "generate_interior_png", generate)
    with TestClient(app_for(tmp_path, FakeCodex()), client=("127.0.0.1", 12)) as client:
        for context in ['{"projectId":"../secret"}', '{"title":12}', '{"file":"private"}', '[]']:
            assert client.post("/api/interior-image", data={"prompt": "light", "context": context}, files=view_file()).status_code == 422
        record = client.post("/api/interior-image", data={"prompt": "light"}, files=view_file()).json()
        for _ in range(50):
            result = client.get("/api/interior-images").json()["items"][0]
            if result["status"] == "failed":
                break
            time.sleep(.02)
        assert "超时" in result["error"]
        assert result["prompt"] == "light"
        assert client.get(record["view_url"]).status_code == 200


def test_capability_does_not_change_ai_source_and_stays_local(tmp_path, monkeypatch):
    app = app_for(tmp_path, FakeCodex())
    app.state.ai_client.connections.data["default_provider"] = "deepseek"
    app.state.ai_client.local.command = str(tmp_path / "missing-cli")
    with TestClient(app, client=("127.0.0.1", 12)) as client:
        capability = client.get("/api/interior-images/capability").json()
        assert capability["available"] is False
        assert capability["verified"] is False
        assert app.state.ai_client.connections.data["default_provider"] == "deepseek"
    with TestClient(app_for(tmp_path / "remote", FakeCodex()), client=("192.0.2.1", 12)) as client:
        assert client.get("/api/interior-images/capability").status_code == 403
        assert client.post("/api/interior-images/" + "a" * 32 + "/cancel").status_code == 403


def item(kind, **kwargs):
    return Furniture(room_id="living", kind=kind, x=3, y=2, width=1, depth=.3, height=.7, rotation=0, **kwargs)


def test_wall_cabinet_access_separates_low_counter_from_door_obstacle():
    cabinet = item("cabinet", elevation=1.5)
    counter = cabinet.model_copy(update={"kind": "counter", "elevation": 0, "height": .9, "depth": .6, "y": 2.15})
    layout = Layout.model_validate(layout_data())
    def warnings(other):
        return [v for v in access_issues(Furnishing(items=[cabinet, other], notes=[]), layout) if v["code"] == "front_access" and v["index"] == 0]
    assert not warnings(counter)
    assert warnings(counter.model_copy(update={"height": 2.2}))
    # 台面前有低落地障碍时仍提示无法站立取物。
    assert warnings(counter.model_copy(update={"y": 2.9, "depth": .4}))
    # 远高于柜门、也不妨碍站立的悬挂物不会误报。
    assert not warnings(counter.model_copy(update={"elevation": 3, "height": .2}))
