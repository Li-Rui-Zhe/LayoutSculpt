import asyncio
import io
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import surface_ai
from backend.tests.test_surface_studio import recipe
from backend.tests.test_workflow import FakeCodex, app_for


def pixels(color=(150, 100, 70, 255)):
    buffer = io.BytesIO()
    Image.new("RGBA", (160, 80), color).save(buffer, "PNG")
    return buffer.getvalue()


def wait_surface(client, identifier, category="walls"):
    for _ in range(500):
        rows = client.get(f"/api/materials/generations?category={category}").json()["items"]
        item = next(row for row in rows if row["id"] == identifier)
        if item["status"] not in {"queued", "running"}:
            return item
        time.sleep(0.02)
    pytest.fail("材质任务未完成")


def test_draw_upload_save_reopen_without_original_source(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        result = client.post(
            "/api/materials/source",
            files={"file": ("draw.png", pixels())},
            data={"category": "walls", "origin": "draw"},
        )
        assert result.status_code == 201
        source = result.json()
        assert source["origin"] == "draw"
        image = Image.open(io.BytesIO(client.get(source["url"]).content))
        assert image.size == (1024, 1024)
        design = {
            **recipe("walls"),
            "base_id": source["id"],
            "color": "#ffffff",
            "origin": "draw",
            "repeat": 1,
            "rotation": 0,
        }
        assert (
            client.post(
                "/api/materials/preview", json={**design, "category": "floor"}
            ).status_code
            == 422
        )
        result = client.post("/api/materials/design", json=design)
        assert result.status_code == 201
        saved = result.json()
        assert saved["recipe"]["origin"] == "draw"
        assert saved["categories"] == ["walls"]
        (tmp_path / "material_sources" / (source["id"].split(":")[1] + ".png")).unlink()
        reopened = client.post(
            "/api/materials/preview", json={**design, "base_id": saved["id"]}
        )
        assert reopened.status_code == 200
        assert Image.open(io.BytesIO(reopened.content)).getpixel((100, 100)) == (
            150,
            100,
            70,
        )
        assert client.post("/api/materials/preview", json=design).status_code == 422


@pytest.mark.parametrize(
    "content",
    [b"not an image", b"x" * (10 * 1024 * 1024 + 1)],
    ids=["invalid-image", "too-large"],
)
def test_invalid_source_rejected(tmp_path, content):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        result = client.post(
            "/api/materials/source",
            files={"file": ("invalid.png", content)},
            data={"category": "floor"},
        )
        assert result.status_code == 422
        assert client.get("/api/materials/sources/invalid.png").status_code == 404


def test_transparent_source_and_category_validation(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:

        def upload(**data):
            return client.post(
                "/api/materials/source",
                files={"file": ("draw.png", pixels((0, 0, 0, 0)))},
                data=data,
            )

        assert upload(category="furniture").status_code == 422
        result = upload(category="floor")
        image = Image.open(io.BytesIO(client.get(result.json()["url"]).content))
        assert image.getpixel((0, 0)) == (255, 255, 255)


def test_ai_success_history_and_save(tmp_path, monkeypatch):
    app = app_for(tmp_path, FakeCodex())

    async def generate(service, identifier, request):
        assert request.category == "walls"
        return pixels(), None

    monkeypatch.setattr(surface_ai, "generate_material", generate)
    with TestClient(app) as client:
        result = client.post(
            "/api/materials/generations",
            json={
                "method": "parametric",
                "category": "walls",
                "prompt": "浅米色细腻微水泥",
            },
        )
        assert result.status_code == 202
        task = wait_surface(client, result.json()["id"])
        assert task["status"] == "succeeded"
        assert task["result"]["origin"] == "ai"
        assert client.get(task["result"]["url"]).status_code == 200
        saved = client.post(
            "/api/materials/design",
            json={**recipe("walls"), "base_id": task["result"]["id"], "origin": "ai"},
        )
        assert saved.status_code == 201
        assert (
            client.get("/api/materials/generations?category=floor").json()["items"]
            == []
        )
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        assert (
            client.get("/api/materials/generations?category=walls").json()["items"][0][
                "status"
            ]
            == "succeeded"
        )


def test_ai_cancel_conflict_failure_and_shutdown(tmp_path, monkeypatch):
    app = app_for(tmp_path, FakeCodex())

    async def delayed(service, identifier, request):
        await asyncio.sleep(30)
        return pixels(), None

    monkeypatch.setattr(surface_ai, "generate_material", delayed)
    request = {"method": "parametric", "category": "walls", "prompt": "自然肌理墙面"}
    with TestClient(app) as client:
        first = client.post("/api/materials/generations", json=request).json()
        assert (
            client.post("/api/materials/generations", json=request).status_code == 409
        )
        cancelled = client.post(f"/api/materials/generations/{first['id']}/cancel")
        assert cancelled.json()["status"] == "cancelled"
        assert (
            client.post("/api/materials/generations/missing/cancel").status_code == 404
        )

        async def failed(service, identifier, request):
            raise RuntimeError("secret-provider-response")

        monkeypatch.setattr(surface_ai, "generate_material", failed)
        second = client.post("/api/materials/generations", json=request).json()
        task = wait_surface(client, second["id"])
        assert task["status"] == "failed" and "secret" not in task["error"]
        monkeypatch.setattr(surface_ai, "generate_material", delayed)
        third = client.post("/api/materials/generations", json=request).json()
        # 运行中请求不自动重发；尚未执行的排队任务由新恢复用例单独覆盖。
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            rows = client.get("/api/materials/generations?category=walls").json()["items"]
            if next(row for row in rows if row["id"] == third["id"])["status"] == "running":
                break
            time.sleep(0.02)
        else:
            pytest.fail("材质任务未进入运行状态")
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        assert wait_surface(client, third["id"])["status"] == "cancelled"


@pytest.mark.parametrize(
    "patch",
    [
        {"prompt": "   "},
        {"quality": "ultra"},
        {"category": "furniture"},
        {"reference_id": "source:../../private"},
        {"reference_id": "source:" + "f" * 64},
    ],
)
def test_ai_request_validation(tmp_path, monkeypatch, patch):
    app = app_for(tmp_path, FakeCodex())

    async def unused(service, identifier, request):
        raise AssertionError("无效请求不得触发生图")

    monkeypatch.setattr(surface_ai, "generate_material", unused)
    with TestClient(app) as client:
        assert (
            client.post(
                "/api/materials/generations",
                json={
                    "method": "parametric",
                    "category": "walls",
                    "prompt": "素色墙面",
                    **patch,
                },
            ).status_code
            == 422
        )


def test_interrupted_task_does_not_restart_paid_generation(tmp_path):
    app = app_for(tmp_path, FakeCodex())
    with TestClient(app) as client:

        async def interrupted():
            db = await app.state.store.connect()
            try:
                await db.execute(
                    "INSERT INTO surface_generations (id,category,prompt,status,result,error,created_at,updated_at,method) VALUES('interrupted','walls','测试墙面','running',NULL,NULL,'2026-01-01','2026-01-01','parametric')"
                )
                await db.commit()
            finally:
                await db.close()

        client.portal.call(interrupted)
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        item = client.get("/api/materials/generations?category=walls").json()["items"][
            0
        ]
        assert item["status"] == "failed" and "重启" in item["error"]


def test_removed_image_requests_cannot_run_and_history_hides_provider(
    tmp_path, monkeypatch
):
    async def forbidden(*args, **kwargs):
        raise AssertionError("旧生图请求不得进入生成器")

    monkeypatch.setattr(surface_ai, "generate_material", forbidden)
    app = app_for(tmp_path, FakeCodex())
    with TestClient(app) as client:
        assert (
            client.post(
                "/api/materials/generations",
                json={"category": "walls", "prompt": "复杂图案", "method": "image"},
            ).status_code
            == 422
        )
        assert client.get("/api/materials/ai-capability").status_code == 404

        async def seed_history():
            db = await app.state.store.connect()
            try:
                for method in ["image", "parametric"]:
                    await db.execute(
                        "INSERT INTO surface_generations (id,category,prompt,status,result,error,created_at,updated_at,method) VALUES(?,?,?,?,?,?,?,?,?)",
                        (
                            method,
                            "walls",
                            "旧记录",
                            "failed",
                            None,
                            "AI 未返回完整图片，请检查 sub2api 服务后重试；当前画布已保留。",
                            "2026-01-01",
                            "2026-01-01",
                            method,
                        ),
                    )
                await db.commit()
            finally:
                await db.close()

        client.portal.call(seed_history)
        response = client.get("/api/materials/generations?category=walls")
        assert [row["id"] for row in response.json()["items"]] == ["parametric"]
        assert "sub2api" not in response.text.lower()
        assert (
            "sub2api"
            not in client.post("/api/materials/generations/image/cancel").text.lower()
        )
