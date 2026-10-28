"""Typed but geometrically invalid recognition pauses for a real user decision."""

import json

import pytest
from fastapi.testclient import TestClient

from backend.app.ai_contracts import pack_layout
from backend.app.recognition_checkpoint import checkpoint_candidate
from backend.app.schemas import Layout
from backend.tests.test_progressive_generation import upload, wait_for
from backend.tests.test_workflow import FakeCodex, app_for, layout_data, wait_job


class InvalidGeometry(FakeCodex):
    overshoot = 0.06
    invalid = True

    async def generate(self, **kwargs):
        text = await super().generate(**kwargs)
        if self.invalid and kwargs["schema"]["title"] == "LayoutExtraction":
            data = json.loads(text)
            data["walls"][0]["b"][0] += self.overshoot
            return json.dumps(data)
        return text


@pytest.mark.parametrize("overshoot,can_continue", [(0.06, True), (1.0, False)])
def test_two_failed_attempts_pause_and_only_user_can_continue(tmp_path, overshoot, can_continue):
    ai = InvalidGeometry()
    ai.overshoot = overshoot
    with TestClient(app_for(tmp_path, ai)) as client:
        job_id = upload(client)
        job = wait_for(client, job_id, lambda j: j["status"] in {"awaiting_review", "failed"})
        assert job["status"] == "awaiting_review", job
        review = job["result"]["recognition_review"]
        assert len(review["attempts"]) == 2
        assert all("w0" in a["issues"][0] for a in review["attempts"])
        assert review["can_continue"] is can_continue
        assert bool(review["adjustments"]) is can_continue
        assert len(ai.calls) == 2  # No furniture or extra AI review before consent.
        assert not (tmp_path / "jobs" / job_id / "model.glb").exists()
        data = client.get(job["result"]["layout_url"]).json()
        layout = {k: v for k, v in data.items() if k in Layout.model_fields}
        url = f"/api/jobs/{job_id}/confirm-structure"
        if not can_continue:
            blocked = client.post(url, json={"layout": layout, "reviewed": True, "revision": job["result"]["revision"]})
            assert blocked.status_code == 422
            layout["walls"][0]["end"]["x"] = 8
        assert client.post(url, json={"layout": layout, "reviewed": True, "revision": "0" * 64}).status_code == 409
        accepted = client.post(url, json={"layout": layout, "reviewed": True, "revision": job["result"]["revision"]})
        assert accepted.status_code == 200, accepted.text
        final = wait_job(client, job_id)
        assert final["status"] == "succeeded", final
        assert len(ai.calls) == 3
        assert final["result"]["consistency"]["source_reviewed"]


def test_user_can_reidentify_from_checkpoint_as_a_new_version(tmp_path):
    ai = InvalidGeometry()
    with TestClient(app_for(tmp_path, ai)) as client:
        old_id = upload(client)
        wait_for(client, old_id, lambda j: j["status"] == "awaiting_review")
        ai.invalid = False
        response = client.post(f"/api/jobs/{old_id}/retry", json={})
        assert response.status_code == 201, response.text
        new_id = response.json()["id"]
        assert new_id != old_id
        assert wait_job(client, new_id)["status"] == "succeeded"
        assert client.get(f"/api/jobs/{old_id}").json()["status"] == "awaiting_review"


def test_legacy_failure_can_show_saved_candidate_without_any_ai_call(tmp_path):
    ai = FakeCodex(malformed=True)
    with TestClient(app_for(tmp_path, ai)) as client:
        job_id = upload(client)
        failed = wait_for(client, job_id, lambda j: j["status"] == "failed")
        assert not failed["can_review_recognition"]
        wire = pack_layout(Layout.model_validate(layout_data()))
        wire["walls"][0]["b"][0] += 0.06
        folder = tmp_path / "jobs" / job_id
        (folder / "recognition-validation.txt").write_text("Value error, 墙体 w0 中心线超出户型轮廓 [type=value_error]\n\n" + json.dumps(wire), encoding="utf-8")
        assert client.get(f"/api/jobs/{job_id}").json()["can_review_recognition"]
        before = len(ai.calls)
        response = client.post(f"/api/jobs/{job_id}/recognition-review")
        assert response.status_code == 200, response.text
        opened = response.json()
        assert opened["status"] == "awaiting_review"
        assert opened["error"] is None
        assert opened["result"]["recognition_review"]["can_continue"]
        assert "第 1 次" in opened["result"]["recognition_review"]["candidate_note"]
        assert len(ai.calls) == before
        assert client.post(f"/api/jobs/{job_id}/recognition-review").status_code == 200
        assert failed["status"] == "failed"


def test_small_parallel_overflow_proposes_translation_without_changing_openings():
    data = layout_data()
    data["outline"] = [{"x": x, "y": y} for x, y in [(0, 0), (4, 0), (4, 2), (3, 2), (3, 5), (0, 5)]]
    data["rooms"][0]["polygon"] = [{"x": x, "y": y} for x, y in [(0.2, 0.2), (2.8, 0.2), (2.8, 4.8), (0.2, 4.8)]]
    wall = data["walls"][0]
    wall["start"], wall["end"] = {"x": 3, "y": 1}, {"x": 3, "y": 4.8}
    data["walls"] = [wall]
    wire = pack_layout(Layout.model_validate(data))
    wire["walls"][0]["a"][0] += 0.06
    wire["walls"][0]["b"][0] += 0.06
    candidate, review = checkpoint_candidate(wire, [{"attempt": 1, "issues": ["越界"]}, {"attempt": 2, "issues": ["越界"]}])
    assert review["can_continue"]
    assert "平移 6.0 厘米" in review["adjustments"][0]
    assert candidate["walls"][0]["start"] == pytest.approx({"x": 3, "y": 1})
    assert candidate["walls"][0]["end"] == pytest.approx({"x": 3, "y": 4.8})
    assert candidate["openings"] == [o.model_dump() for o in Layout.model_validate(data).openings]
    Layout.model_validate(candidate)
