import json
from io import BytesIO

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.glb_limits import validate_glb_budget
from backend.app.instance_lock import instance_lock
from backend.app.main import normalize_image
from backend.tests.test_workflow import (
    FakeCodex,
    app_for,
    create_job,
    image_bytes,
    wait_job,
)


def test_transparent_plan_uses_white_background():
    image = Image.new("RGBA", (12, 12), (0, 0, 0, 0))
    image.putpixel((3, 3), (0, 0, 0, 255))
    raw = BytesIO()
    image.save(raw, "PNG")
    result = Image.open(BytesIO(normalize_image(raw.getvalue())))
    assert result.getpixel((0, 0)) == (255, 255, 255)
    assert result.getpixel((3, 3)) == (0, 0, 0)


def test_corrupt_metadata_is_isolated_and_invalid_numbers_rejected(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        job = wait_job(client, create_job(client)["id"])
        (tmp_path / "jobs" / job["id"] / "rebuild-seed.json").write_text(
            "{broken", encoding="utf-8"
        )
        assert client.get("/api/jobs").json()["items"][0]["record_warning"]
        assert client.get("/api/jobs/changes").status_code == 200
        root = tmp_path / "materials"
        root.mkdir(exist_ok=True)
        (root / ("a" * 64 + ".json")).write_text("{broken", encoding="utf-8")
        listing = client.get("/api/materials/custom")
        assert listing.status_code == 200 and len(listing.json()["unavailable"]) == 1
        response = client.post(
            "/api/drafts/edit:new",
            content='{"revision":0,"document":{"x":NaN}}',
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422 and "无效数值" in response.json()["detail"]


def test_atomic_creation_recovers_after_response_loss(tmp_path):
    app = app_for(tmp_path, FakeCodex())
    with TestClient(app, raise_server_exceptions=False) as client:
        schedule = app.state.runner.schedule

        def crash(*args, **kwargs):
            raise RuntimeError("simulated process boundary after commit")

        app.state.runner.schedule = crash
        headers = {"Idempotency-Key": "atomic-create-request-001"}
        kwargs = {
            "files": {"file": ("plan.png", image_bytes(), "image/png")},
            "data": {"collaboration": "false"},
            "headers": headers,
        }
        assert client.post("/api/jobs", **kwargs).status_code == 500
        original = client.get("/api/jobs").json()["items"]
        assert len(original) == 1
        app.state.runner.schedule = schedule
        recovered = client.post("/api/jobs", **kwargs)
        assert (
            recovered.status_code == 201 and recovered.json()["id"] == original[0]["id"]
        )
        assert len(client.get("/api/jobs").json()["items"]) == 1
        assert wait_job(client, recovered.json()["id"])["status"] == "succeeded"
        changed = {**kwargs, "data": {"collaboration": "true"}}
        assert client.post("/api/jobs", **changed).status_code == 409


def test_request_body_limit_precedes_multipart_parser(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        response = client.post(
            "/api/jobs",
            content=b"",
            headers={
                "content-length": str(22 * 1024 * 1024),
                "content-type": "multipart/form-data; boundary=x",
            },
        )
        assert response.status_code == 413
        assert client.get("/api/jobs").json()["items"] == []


def test_single_instance_lock_can_be_reacquired(tmp_path):
    with instance_lock(tmp_path), pytest.raises(RuntimeError, match="已有服务"):  # noqa: SIM117 - 锁冲突本身是被测操作
        with instance_lock(tmp_path):
            pass
    with instance_lock(tmp_path):
        pass


def test_glb_budget_rejects_cycles_and_oversized_accessors():
    with pytest.raises(ValueError, match="循环"):
        validate_glb_budget({"nodes": [{"children": [0]}]}, b"", 0)
    with pytest.raises(ValueError, match="几何数据"):
        validate_glb_budget({"accessors": [{"count": 20_000_001}]}, b"", 0)
    with pytest.raises(ValueError, match="多个父级"):
        validate_glb_budget(
            {"nodes": [{"children": [2]}, {"children": [2]}, {}]}, b"", 0
        )


def test_error_boundary_hides_paths_credentials_and_raw_validation(tmp_path):
    from backend.app.public_errors import public_message

    assert "C:" not in public_message("无法连接 C:\\Users\\admin\\private.txt")
    assert "secret" not in public_message("上游错误 Bearer secret")
    app = app_for(tmp_path, FakeCodex())

    @app.get("/api/test-private-error")
    async def error():
        raise HTTPException(503, "上游响应 https://private.example/?key=secret")

    app.router.routes.insert(0, app.router.routes.pop())
    with TestClient(app) as client:
        result = client.get("/api/test-private-error")
        assert result.status_code == 503 and "secret" not in result.text
        response = client.post(
            "/api/materials/generations",
            json={"category": "invalid", "prompt": "私密输入"},
        )
        assert response.status_code == 422 and "私密输入" not in response.text


def test_history_pages_include_ancestors_and_do_not_skip_changes(tmp_path):
    from backend.app.schemas import JobOptions

    app = app_for(tmp_path, FakeCodex())
    with TestClient(app) as client:

        async def seed():
            for i in range(45):
                identifier = f"{i:032x}"
                await app.state.store.create(
                    identifier, f"任务{i}", JobOptions().model_dump()
                )
                await app.state.store.update(identifier, status="succeeded")
            folder = tmp_path / "jobs" / f"{44:032x}"
            folder.mkdir(parents=True)
            (folder / "rebuild-seed.json").write_text(
                json.dumps({"edited_of": f"{0:032x}"}), encoding="utf-8"
            )

        client.portal.call(seed)
        first = client.get("/api/jobs/page").json()
        assert len(first["items"]) == 41 and any(
            i["id"] == f"{0:032x}" for i in first["items"]
        )
        second = client.get("/api/jobs/page", params={"before": first["before"]}).json()
        assert len(second["items"]) == 5 and second["before"] is None
        assert len({i["id"] for i in first["items"] + second["items"]}) == 45
        client.portal.call(
            app.state.store.create, f"{45:032x}", "新任务", JobOptions().model_dump()
        )
        changed = client.get(
            "/api/jobs/changes", params={"cursor": first["cursor"]}
        ).json()
        assert [i["id"] for i in changed["items"]] == [f"{45:032x}"]


def test_material_management_archive_preserves_image_and_cleanup_scope(tmp_path):
    import os
    import time

    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        item = client.post(
            "/api/materials/custom", files={"file": ("a.png", image_bytes())}
        ).json()
        assert (
            client.post(
                "/api/library/manage",
                json={"id": item["id"], "name": "我的羊毛地毯", "archived": True},
            ).status_code
            == 200
        )
        assert client.get("/api/materials/custom").json()["items"] == []
        archived = client.get("/api/materials/custom?archived=true").json()["items"]
        assert archived[0]["name"] == "我的羊毛地毯"
        assert (
            client.get(f"/api/materials/custom/{item['id'][8:]}.png").status_code == 200
        )
        assert (
            client.post(
                "/api/library/manage", json={"id": item["id"], "archived": False}
            ).status_code
            == 200
        )
        assert len(client.get("/api/materials/custom").json()["items"]) == 1
        cache = tmp_path / "ai-cache" / "old.json"
        cache.parent.mkdir(exist_ok=True)
        cache.write_text("{}")
        fresh = cache.with_name("fresh.json")
        fresh.write_text("{}")
        os.utime(cache, (time.time() - 31 * 86400,) * 2)
        assert client.post("/api/library/cache/clean").json()["removed_bytes"] == 2
        assert fresh.is_file() and not cache.exists()
        assert len(client.get("/api/library/manage").json()["items"]) == 1


def test_export_budget_closes_temporary_file_on_rejection(monkeypatch):
    from backend.app import archive_limits

    monkeypatch.setattr(archive_limits, "MAX_UNCOMPRESSED", 20)
    output = BytesIO()
    with (
        pytest.raises(ValueError, match="上限"),
        archive_limits.PortableArchive(output) as archive,
    ):
        archive.writestr("large", b"x" * 21)
    assert output.closed


def test_surface_retry_retains_selected_model_and_effort(tmp_path, monkeypatch):
    from backend.app import surface_ai
    from backend.tests.test_surface_creation import pixels, wait_surface

    requests = []

    async def generate(service, identifier, request):
        requests.append(request)
        if len(requests) == 1:
            raise RuntimeError("private upstream response")
        return pixels(), None

    monkeypatch.setattr(surface_ai, "generate_material", generate)
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        body = {
            "category": "walls",
            "prompt": "米白色墙面",
            "model": "test-chosen",
            "reasoning_effort": "high",
        }
        first = client.post("/api/materials/generations", json=body).json()
        assert wait_surface(client, first["id"])["status"] == "failed"
        second = client.post(f"/api/materials/generations/{first['id']}/retry")
        assert second.status_code == 202
        assert wait_surface(client, second.json()["id"])["status"] == "succeeded"
        assert (
            requests[1].model == "test-chosen"
            and requests[1].reasoning_effort == "high"
        )
        assert (
            client.post(
                "/api/materials/generations",
                json={**body, "reasoning_effort": "unsupported"},
            ).status_code
            == 422
        )


def test_manual_preview_uses_real_builder(tmp_path, monkeypatch):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        job = wait_job(client, create_job(client)["id"])
        document = client.get(job["result"]["layout_url"]).json()
        furniture = document.pop("furniture")
        from backend.app.schemas import Layout

        layout = Layout.model_validate(
            {k: v for k, v in document.items() if k in Layout.model_fields}
        ).model_dump()
        response = client.post(
            f"/api/jobs/{job['id']}/preview",
            json={
                "name": "预览",
                "layout": layout,
                "furniture": {"items": furniture, "notes": []},
            },
        )
        assert response.status_code == 200, response.text
        assert response.content.startswith(b"glTF") and len(response.content) > 1000
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-preview-cache"] == "miss"
        async def no_rebuild(*args, **kwargs):
            raise AssertionError("同一草稿不应该再次建模")
        monkeypatch.setattr("backend.app.modeling.build_model", no_rebuild)
        cached = client.post(f"/api/jobs/{job['id']}/preview", json={
            "name": "不同的预览名称", "layout": layout,
            "furniture": {"items": furniture, "notes": []},
        })
        assert cached.headers["x-preview-cache"] == "hit"
        assert cached.content == response.content



def test_review_preview_does_not_confirm_or_call_ai(tmp_path):
    from backend.tests.test_structure_review import pending, payload

    codex = FakeCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        job = pending(client, create_job(client)["id"])
        layout = payload(client, job)["layout"]
        before = len(codex.calls)
        endpoint = f"/api/jobs/{job['id']}/preview"
        body = {"name": "三维实时设计", "layout": layout, "furniture": {"items": [], "notes": []}}
        response = client.post(endpoint, json=body)
        assert response.status_code == 200, response.text
        assert response.content.startswith(b"glTF")
        unchanged = client.get(f"/api/jobs/{job['id']}").json()
        assert unchanged["status"] == "awaiting_review"
        assert unchanged["result"] == job["result"]
        assert len(codex.calls) == before
        body["layout"]["walls"][0]["height"] = -1
        assert client.post(endpoint, json=body).status_code == 422
