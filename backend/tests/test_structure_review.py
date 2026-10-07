import time
import asyncio
import hashlib
import json
import pytest

from fastapi.testclient import TestClient

from backend.app.consistency import structure_hash
from backend.app.schemas import Layout
from backend.tests.test_workflow import FakeCodex, app_for, create_job, wait_job, fake_builder
from dataclasses import replace
from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.codex import CodexError
from backend.app.recovery import REVIEW_TIMEOUT_WARNING
from backend.tests.test_workflow import layout_data


def pending(client, job_id):
    for _ in range(200):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] == "awaiting_review":
            return job
        assert job["status"] not in {"failed", "cancelled"}, job
        time.sleep(0.025)
    raise AssertionError("未进入结构确认阶段")


def payload(client, job):
    recognized = client.get(f"/api/jobs/{job['id']}/artifacts/structure.json").json()
    return {"reviewed": True, "revision": job["result"]["revision"],
            "layout": {key: value for key, value in recognized.items() if key in Layout.model_fields}}


def test_review_gate_survives_restart_and_blocks_unconfirmed_model(tmp_path):
    codex = FakeCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        job = pending(client, create_job(client)["id"])
        assert [call["schema"]["title"] for call in codex.calls] == ["LayoutExtraction", "LayoutReviewPatch"]
        assert client.get(f"/api/jobs/{job['id']}/artifacts/model.glb").status_code == 409
        assert client.get(f"/api/jobs/{job['id']}/artifacts/consistency-report.json").status_code == 409
        request = payload(client, job)
    # Waiting for a human does not become a failed job after a restart.
    resumed = FakeCodex()
    with TestClient(app_for(tmp_path, resumed)) as client:
        assert client.get(f"/api/jobs/{job['id']}").json()["status"] == "awaiting_review"
        path = f"/api/jobs/{job['id']}/confirm-structure"
        assert client.post(path, json={**request, "reviewed": False}).status_code == 422
        assert client.post(path, json={**request, "revision": "0" * 64}).status_code == 409
        # The user may correct a door before confirming it.
        request["layout"]["openings"][0]["width"] = 1.0
        expected = structure_hash(Layout.model_validate(request["layout"]))
        assert client.post(path, json=request).status_code == 200
        assert client.post(path, json=request).status_code == 409
        final = wait_job(client, job["id"])
        assert final["status"] == "succeeded", final
        proof = final["result"]["consistency"]
        assert proof["source_reviewed"]
        assert proof["confirmation"]["structure_hash"] == expected
        assert [call["schema"]["title"] for call in resumed.calls] == ["Furnishing"]
        delivered = client.get(final["result"]["layout_url"]).json()
        assert structure_hash(delivered) == expected


def test_pending_task_can_be_cancelled_and_cannot_be_confirmed(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        job = pending(client, create_job(client, collaboration=False)["id"])
        request = payload(client, job)
        assert client.post(f"/api/jobs/{job['id']}/cancel").json()["status"] == "cancelled"
        assert client.post(f"/api/jobs/{job['id']}/confirm-structure", json=request).status_code == 409


def test_added_window_without_door_defaults_survives_confirmation_and_reload(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        job = pending(client, create_job(client)["id"])
        request = payload(client, job)
        request["layout"]["openings"].append({
            "wall_id": "w1", "kind": "window", "offset": 1,
            "width": 1.2, "height": 1.2, "bottom": 0.9,
        })
        assert client.post(f"/api/jobs/{job['id']}/confirm-structure", json=request).status_code == 200
        final = wait_job(client, job["id"])
        assert final["status"] == "succeeded", final
        delivered = client.get(final["result"]["layout_url"]).json()
        assert len(delivered["openings"]) == 2
        assert structure_hash(delivered) == final["result"]["consistency"]["confirmation"]["structure_hash"]


def test_retry_compatibility_with_legacy_integer_defaults_keeps_human_confirmation(tmp_path):
    failing = {"enabled": True}
    async def builder(settings, workspace, *args, **kwargs):
        if failing["enabled"]:
            raise RuntimeError("模拟旧版本建模失败")
        return await fake_builder(settings, workspace, *args, **kwargs)
    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(create_app(settings, client=FakeCodex(), model_builder=builder)) as client:
        job = wait_job(client, create_job(client)["id"])
        path = settings.workspace(job["id"]) / "rebuild-seed.json"
        seed = json.loads(path.read_text(encoding="utf-8"))
        seed["layout"]["openings"][0]["angle"] = 90
        data = seed["layout"]
        geometry = {
            "outline": data["outline"],
            "rooms": [{key: room[key] for key in ("id", "name", "kind", "polygon")} for room in data["rooms"]],
            "walls": [{key: wall[key] for key in ("id", "start", "end", "thickness", "height", "exterior")} for wall in data["walls"]],
            "openings": data["openings"],
        }
        legacy = hashlib.sha256(json.dumps(geometry, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        seed["confirmation"]["structure_hash"] = legacy
        path.write_text(json.dumps(seed, ensure_ascii=False), encoding="utf-8")
        original = path.read_bytes()
        failing["enabled"] = False
        response = client.post(f"/api/jobs/{job['id']}/retry")
        assert response.status_code == 201
        final = wait_job(client, response.json()["id"])
        assert final["status"] == "succeeded", final
        proof = final["result"]["consistency"]
        assert proof["source_reviewed"]
        assert proof["confirmation"]["legacy_structure_hash"] == legacy
        assert proof["confirmation"]["structure_hash"] == structure_hash(seed["layout"])
        assert path.read_bytes() == original


def test_local_service_rejects_external_host(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        assert client.get("/api/health", headers={"host": "attacker.example"}).status_code == 400


def test_confirmed_retry_uses_new_workspace_and_keeps_original_unchanged(tmp_path):
    fail = {"enabled": True}
    paths = []
    async def builder(settings, workspace, *args, **kwargs):
        paths.append(workspace)
        if fail["enabled"]:
            raise RuntimeError("验收用建模失败")
        return await fake_builder(settings, workspace, *args, **kwargs)
    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(create_app(settings, client=FakeCodex(), model_builder=builder)) as client:
        job = wait_job(client, create_job(client)["id"])
        assert job["status"] == "failed"
        seed = (settings.workspace(job["id"]) / "rebuild-seed.json").read_bytes()
        fail["enabled"] = False
        retry = client.post(f"/api/jobs/{job['id']}/retry")
        assert retry.status_code == 201
        final = wait_job(client, retry.json()["id"])
        assert final["status"] == "succeeded", final
        assert paths == [settings.workspace(job["id"]), settings.workspace(final["id"])]
        assert (settings.workspace(job["id"]) / "rebuild-seed.json").read_bytes() == seed
        assert not (settings.workspace(job["id"]) / "model.glb").exists()
        assert final["result"]["consistency"]["source_reviewed"]


class ReviewFailureCodex(FakeCodex):
    def __init__(self, *, failure=None, slow=False):
        super().__init__()
        self.failure = failure
        self.slow = slow
        self.review_cancelled = False

    async def generate(self, **kwargs):
        if "floorplan-review" in kwargs["instructions"]:
            self.calls.append(kwargs)
            if self.slow:
                try:
                    await asyncio.sleep(60)
                except asyncio.CancelledError:
                    self.review_cancelled = True
                    raise
            raise self.failure or TimeoutError()
        return await super().generate(**kwargs)


@pytest.mark.parametrize("slow", [False, True])
def test_optional_review_timeout_preserves_structure_and_requires_confirmation(tmp_path, slow):
    codex = ReviewFailureCodex(slow=slow)
    settings = replace(Settings(), data_dir=tmp_path, review_timeout=0.03)
    with TestClient(create_app(settings, client=codex, model_builder=fake_builder)) as client:
        job = pending(client, create_job(client)["id"])
        assert job["error"] is None
        assert job["result"]["ai_review"]["status"] == "timed_out"
        assert REVIEW_TIMEOUT_WARNING in job["result"]["warnings"]
        structure = client.get(job["result"]["layout_url"]).json()
        initial = Layout.model_validate_json((settings.workspace(job["id"]) / "recognition.json").read_text(encoding="utf-8"))
        assert structure_hash(structure) == structure_hash(initial)
        assert initial.model_dump(exclude={"warnings"}) == Layout.model_validate(layout_data()).model_dump(exclude={"warnings"})
        assert client.get(f"/api/jobs/{job['id']}/artifacts/model.glb").status_code == 409
        confirmation = payload(client, job)
        assert client.post(f"/api/jobs/{job['id']}/confirm-structure", json={**confirmation, "reviewed": False}).status_code == 422
        assert not (settings.workspace(job["id"]) / "review.json").exists()
        if slow:
            assert codex.review_cancelled
        assert client.post(f"/api/jobs/{job['id']}/confirm-structure", json=confirmation).status_code == 200
        final = wait_job(client, job["id"])
        assert final["status"] == "succeeded"
        assert final["result"]["ai_review"]["status"] == "timed_out"
        assert final["result"]["consistency"]["source_reviewed"]


def test_failed_review_can_recover_without_repeating_ai_or_changing_original(tmp_path):
    codex = ReviewFailureCodex(failure=CodexError("复核连接中断"))
    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(create_app(settings, client=codex, model_builder=fake_builder)) as client:
        failed = wait_job(client, create_job(client)["id"])
        assert failed["status"] == "failed"  # Other errors are not silently treated as timeouts.
        assert failed["can_recover_structure"]
        original = (settings.workspace(failed["id"]) / "recognition.json").read_bytes()
        async def unavailable_models(refresh=False):
            raise CodexError("模型服务暂时不可用")
        codex.list_models = unavailable_models
        response = client.post(f"/api/jobs/{failed['id']}/retry", json={"reuse_structure": True})
        assert response.status_code == 201, response.text
        job = pending(client, response.json()["id"])
        assert len(codex.calls) == 2
        assert job["result"]["ai_review"]["status"] == "incomplete"
        assert job["result"]["recovered_structure_of"] == failed["id"]
        assert structure_hash(client.get(job["result"]["layout_url"]).json()) == structure_hash(Layout.model_validate_json(original))
        assert client.get(f"/api/jobs/{failed['id']}").json() == failed
        assert (settings.workspace(failed["id"]) / "recognition.json").read_bytes() == original
        assert (settings.workspace(job["id"]) / "source.png").read_bytes() == (settings.workspace(failed["id"]) / "source.png").read_bytes()
        assert client.get(f"/api/jobs/{job['id']}/artifacts/model.glb").status_code == 409


@pytest.mark.parametrize("artifact", ["recognition.json", "source.png", "recognition-meta.json"])
def test_recovery_rejects_corrupt_or_mismatched_intermediate_results(tmp_path, artifact):
    codex = ReviewFailureCodex(failure=CodexError("复核失败"))
    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(create_app(settings, client=codex, model_builder=fake_builder)) as client:
        failed = wait_job(client, create_job(client)["id"])
        path = settings.workspace(failed["id"]) / artifact
        path.write_text("{}", encoding="utf-8")
        assert client.get(f"/api/jobs/{failed['id']}").json()["can_recover_structure"] is False
        before = len(client.get("/api/jobs").json()["items"])
        assert client.post(f"/api/jobs/{failed['id']}/retry", json={"reuse_structure": True}).status_code == 409
        assert len(client.get("/api/jobs").json()["items"]) == before


def test_cancel_during_review_does_not_fall_back_to_human_review(tmp_path):
    codex = ReviewFailureCodex(slow=True)
    with TestClient(app_for(tmp_path, codex)) as client:
        job = create_job(client)
        for _ in range(200):
            if len(codex.calls) == 2:
                break
            time.sleep(0.025)
        assert len(codex.calls) == 2
        cancelled = client.post(f"/api/jobs/{job['id']}/cancel").json()
        assert cancelled["status"] == "cancelled"
        assert codex.review_cancelled
        assert not (tmp_path / "jobs" / job["id"] / "structure.json").exists()


def test_recovery_rejects_model_override_and_recognition_timeout_still_fails(tmp_path):
    codex = FakeCodex()
    async def timeout(**kwargs):
        raise TimeoutError()
    codex.generate = timeout
    with TestClient(app_for(tmp_path, codex)) as client:
        job = wait_job(client, create_job(client)["id"])
        assert job["status"] == "failed" and job["progress"] == 12
        assert "识别户型结构超时" in job["error"]
        assert job["can_recover_structure"] is False
        assert client.post(f"/api/jobs/{job['id']}/retry", json={"reuse_structure": True}).status_code == 409
        assert client.post(f"/api/jobs/{job['id']}/retry", json={"reuse_structure": True, "model": "test-chosen"}).status_code == 422
