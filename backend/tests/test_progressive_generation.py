"""渐进展示与同任务恢复：真实节点、隔离数据和确定性 AI 替身。"""

import asyncio
import time
from dataclasses import replace

from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.modeling import build_model
from backend.app.store import Store
from backend.tests.test_workflow import FakeCodex, fake_builder, image_bytes, wait_job


def upload(client, **options):
    response = client.post("/api/jobs", files={"file": ("plan.png", image_bytes(), "image/png")},
                           data={"review_mode": "preview", **options})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def wait_for(client, job_id, predicate, *, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if predicate(job):
            return job
        time.sleep(.025)
    raise AssertionError(job)


class FurnitureGate(FakeCodex):
    blocked = True
    released = False

    async def generate(self, **kwargs):
        if kwargs["schema"]["title"] == "Furnishing":
            if self.blocked:
                raise RuntimeError("authentication failed 401")
            while not self.released:
                await asyncio.sleep(.02)
        return await super().generate(**kwargs)


def test_preview_then_continue_same_job_without_repeating_completed_ai(tmp_path):
    codex = FurnitureGate()
    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(create_app(settings, client=codex, model_builder=fake_builder)) as client:
        job_id = upload(client)
        failed = wait_for(client, job_id, lambda j: j["status"] == "failed")
        assert failed["result"]["failure"]["code"] == "authentication"
        initial = failed["result"]["preview"]
        assert initial["source_reviewed"] is False
        assert client.get(initial["model_url"]).content.startswith(b"glTF")
        assert client.get(f"/api/jobs/{job_id}/artifacts/model.glb").status_code == 409
        assert client.get(f"/api/jobs/{job_id}/preview/source.png").status_code == 404
        calls = len(codex.calls)
        # 人工草稿以及其他版本完全不属于恢复写入范围。
        draft_url = f"/api/drafts/edit:{job_id}"
        assert client.post(draft_url, json={"revision": 0, "document": {"user_change": True}}).status_code == 200
        draft = client.get(draft_url).json()
        codex.blocked = False
        response = client.post(f"/api/jobs/{job_id}/continue", json={"revision": failed["updated_at"]})
        assert response.status_code == 200, response.text
        assert response.json()["id"] == job_id
        active = wait_for(client, job_id, lambda j: j["status"] == "running")
        assert not active.get("error")
        assert "failure" not in active["result"]
        duplicate = client.post(f"/api/jobs/{job_id}/continue", json={"revision": failed["updated_at"]})
        assert duplicate.status_code == 200
        codex.released = True
        final = wait_for(client, job_id, lambda j: j["status"] == "succeeded")
        assert len(codex.calls) == calls + 1
        assert not final["result"]["consistency"]["source_reviewed"]
        assert final["result"]["consistency"]["confirmation"] is None
        assert client.get(draft_url).json() == draft
        assert len(client.get("/api/jobs").json()["items"]) == 1
        assert client.post(f"/api/jobs/{job_id}/continue", json={"revision": failed["updated_at"]}).status_code == 409


def test_real_preview_is_readable_before_furniture_finishes(tmp_path):
    codex = FurnitureGate()
    codex.blocked = False
    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(create_app(settings, client=codex, model_builder=build_model)) as client:
        job_id = upload(client)
        # 真建模会冷启动独立 Python 进程；这里只检验初稿先于家具可读，
        # 不将开发机负载下的冷启动时间作为 15 秒性能门槛。
        job = wait_for(client, job_id, lambda j: bool((j.get("result") or {}).get("preview")), timeout=120)
        assert job["status"] == "running"
        preview = job["result"]["preview"]
        assert client.get(preview["model_url"]).content[:4] == b"glTF"
        document = client.get(preview["layout_url"]).json()
        assert len(document["walls"]) == 4 and len(document["openings"]) == 1
        assert document["furniture"] == []
        assert preview["consistency"]["geometry_verified"] is True
        codex.released = True
        final = wait_for(client, job_id, lambda j: j["status"] in {"succeeded", "failed"}, timeout=120)
        assert final["status"] == "succeeded", final


def test_build_failure_resumes_only_build_and_old_request_cannot_restart_next_failure(tmp_path):
    codex = FakeCodex()
    attempts = 0

    async def builder(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise RuntimeError("model build unavailable")
        return await fake_builder(*args, **kwargs)

    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(create_app(settings, client=codex, model_builder=builder)) as client:
        job_id = upload(client, review_mode="manual")
        failed = wait_job(client, job_id)
        assert failed["status"] == "failed"
        original_calls = len(codex.calls)
        body = {"revision": failed["updated_at"]}
        assert client.post(f"/api/jobs/{job_id}/continue", json=body).status_code == 200
        failed_again = wait_for(client, job_id, lambda j: j["status"] == "failed")
        assert client.post(f"/api/jobs/{job_id}/continue", json=body).status_code == 409
        assert client.post(f"/api/jobs/{job_id}/continue", json={"revision": failed_again["updated_at"]}).status_code == 200
        final = wait_job(client, job_id)
        assert final["status"] == "succeeded"
        assert len(codex.calls) == original_calls
        assert final["result"]["consistency"]["source_reviewed"] is True


def test_store_continue_claim_is_atomic_and_does_not_reopen_success(tmp_path):
    async def check():
        store = Store(tmp_path / "test.sqlite3")
        await store.initialize()
        await store.create("test", "测试", {})
        await store.update("test", status="failed", result={"preview": {"ready": True}}, error="失败")
        job = await store.get("test")
        claims = await asyncio.gather(*(store.continue_job("test", job["updated_at"]) for _ in range(6)))
        assert claims.count(True) == 1
        assert (await store.get("test"))["result"]["preview"]["ready"]
        await store.update("test", status="succeeded")
        job = await store.get("test")
        assert not await store.continue_job("test", job["updated_at"])
    asyncio.run(check())


def test_preview_survives_restart_and_resumes_only_furniture(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path)
    first = FurnitureGate()
    first.blocked = False
    with TestClient(create_app(settings, client=first, model_builder=fake_builder)) as client:
        job_id = upload(client)
        wait_for(client, job_id, lambda j: j["stage"] == "规划家具布置")
    second = FurnitureGate()
    second.blocked = False
    second.released = True
    with TestClient(create_app(settings, client=second, model_builder=fake_builder)) as client:
        final = wait_for(client, job_id, lambda j: j["status"] in {"succeeded", "failed"})
        assert final["status"] == "succeeded", final
        assert [call["schema"]["title"] for call in second.calls] == ["Furnishing"]
        assert final["result"]["consistency"]["source_reviewed"] is False


def test_incomplete_ai_review_still_requests_explicit_review(tmp_path):
    class ReviewTimeout(FakeCodex):
        async def generate(self, **kwargs):
            if kwargs["schema"]["title"] == "LayoutReviewPatch":
                raise TimeoutError("测试复核超时")
            return await super().generate(**kwargs)

    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(create_app(settings, client=ReviewTimeout(), model_builder=fake_builder)) as client:
        job_id = upload(client)
        job = wait_for(client, job_id, lambda j: j["status"] == "awaiting_review")
        assert job["result"]["ai_review"]["status"] == "timed_out"
        assert "preview" not in job["result"]
        assert client.get(f"/api/jobs/{job_id}/preview/model.glb").status_code == 404
        final = wait_job(client, job_id)
        assert final["status"] == "succeeded"
        assert final["result"]["consistency"]["source_reviewed"] is True


def test_source_changed_during_unconfirmed_build_cannot_be_delivered(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path)

    async def mutate_on_final(settings, workspace, *args, **kwargs):
        report = await fake_builder(settings, workspace, *args, **kwargs)
        if (workspace / "source.png").is_file():
            (workspace / "source.png").write_bytes(b"changed-source")
        return report

    with TestClient(create_app(settings, client=FakeCodex(), model_builder=mutate_on_final)) as client:
        job_id = upload(client)
        final = wait_for(client, job_id, lambda j: j["status"] in {"succeeded", "failed"})
        assert final["status"] == "failed"
        assert "preview" in final["result"]
        assert "model_url" not in final["result"]
        assert client.get(f"/api/jobs/{job_id}/artifacts/model.glb").status_code == 409
