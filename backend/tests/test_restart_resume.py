import asyncio
import json
import sqlite3
import time
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.tests.test_structure_review import pending, payload
from backend.tests.test_workflow import FakeCodex, create_job, fake_builder, wait_job


class InterruptedCodex(FakeCodex):
    def __init__(self, stage):
        super().__init__()
        self.stage = stage
        self.entered = False

    async def generate(self, **kwargs):
        if kwargs["schema"]["title"] == self.stage:
            self.entered = True
            await asyncio.sleep(60)
        return await super().generate(**kwargs)


def wait_entered(codex):
    for _ in range(200):
        if codex.entered:
            return
        time.sleep(0.025)
    raise AssertionError("未进入模拟中断阶段")


def app(settings, codex):
    return create_app(settings, client=codex, model_builder=fake_builder)


def test_restart_resumes_review_without_repeating_recognition_or_confirming_user(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path, ai_cache_enabled=False)
    first = InterruptedCodex("LayoutReviewPatch")
    with TestClient(app(settings, first)) as client:
        job = create_job(client)
        wait_entered(first)
    resumed = FakeCodex()
    with TestClient(app(settings, resumed)) as client:
        final = pending(client, job["id"])
        assert final["status"] == "awaiting_review"
        assert [call["schema"]["title"] for call in resumed.calls] == ["LayoutReviewPatch"]
        assert client.get(f"/api/jobs/{job['id']}/artifacts/model.glb").status_code == 409
        assert len(client.get("/api/jobs").json()["items"]) == 1


def test_restart_after_confirmation_resumes_furniture_without_losing_manual_changes(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path, ai_cache_enabled=False)
    first = InterruptedCodex("Furnishing")
    with TestClient(app(settings, first)) as client:
        job = pending(client, create_job(client)["id"])
        confirmation = payload(client, job)
        confirmation["layout"]["openings"][0]["width"] = 1.05
        assert client.post(f"/api/jobs/{job['id']}/confirm-structure", json=confirmation).status_code == 200
        wait_entered(first)
    resumed = FakeCodex()
    with TestClient(app(settings, resumed)) as client:
        final = wait_job(client, job["id"])
        assert final["status"] == "succeeded", final
        assert [call["schema"]["title"] for call in resumed.calls] == ["Furnishing"]
        assert final["result"]["consistency"]["source_reviewed"]
        doc = client.get(final["result"]["layout_url"]).json()
        assert doc["openings"][0]["width"] == 1.05


def test_restart_rejects_changed_source_instead_of_reusing_checkpoint(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path, ai_cache_enabled=False)
    first = InterruptedCodex("LayoutReviewPatch")
    with TestClient(app(settings, first)) as client:
        job = create_job(client)
        wait_entered(first)
    (settings.workspace(job["id"]) / "source.png").write_bytes(b"modified-source")
    resumed = FakeCodex()
    with TestClient(app(settings, resumed)) as client:
        final = wait_job(client, job["id"])
        assert final["status"] == "failed"
        assert "恢复记录" in final["error"]
        assert not resumed.calls


def test_crash_between_checkpoint_and_final_status_does_not_repeat_ai(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path, ai_cache_enabled=False)
    with TestClient(app(settings, FakeCodex())) as client:
        job = wait_job(client, create_job(client)["id"])
        assert job["status"] == "succeeded"
    # Simulate the DB status not being written after a completed graph checkpoint.
    with sqlite3.connect(settings.db_path) as db:
        db.execute("UPDATE jobs SET status='running',progress=99 WHERE id=?", (job["id"],))
    resumed = FakeCodex(malformed=True)
    with TestClient(app(settings, resumed)) as client:
        final = wait_job(client, job["id"])
        assert final["status"] == "succeeded", final
        assert final["result"]["consistency"]["source_reviewed"]
        assert not resumed.calls


def test_checkpoint_cannot_restore_success_when_model_file_has_disappeared(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(app(settings, FakeCodex())) as client:
        job = wait_job(client, create_job(client)["id"])
    with sqlite3.connect(settings.db_path) as db:
        db.execute("UPDATE jobs SET status='running',progress=99 WHERE id=?", (job["id"],))
    (settings.workspace(job["id"]) / "model.glb").unlink()
    with TestClient(app(settings, FakeCodex())) as client:
        final = wait_job(client, job["id"])
        assert final["status"] == "failed"
        assert "模型文件缺失" in final["error"]
