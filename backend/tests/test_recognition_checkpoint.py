"""Automatic geometry recovery and the optional single confirmation before 3D."""

import json

import pytest
from fastapi.testclient import TestClient

from backend.app.ai_contracts import pack_layout
from backend.app.recognition_checkpoint import checkpoint_candidate
from backend.app.schemas import Layout
from backend.tests.test_progressive_generation import upload, wait_for
from backend.tests.test_workflow import FakeCodex, app_for, layout_data


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


@pytest.mark.parametrize("mode", ["preview", "manual"])
@pytest.mark.parametrize("overshoot", [0.06, 1.0])
def test_geometry_resolved_before_only_selected_confirmation(tmp_path, mode, overshoot):
    class Recoverable(InvalidGeometry):
        async def generate(self, **kwargs):
            if "对照原图修正候选结构中的几何错误" in kwargs["prompt"]:
                return await FakeCodex.generate(self, **kwargs)
            return await super().generate(**kwargs)

    ai = Recoverable()
    ai.overshoot = overshoot
    with TestClient(app_for(tmp_path, ai)) as client:
        job_id = upload(client, review_mode=mode)
        terminal = {"awaiting_review", "succeeded", "failed"}
        job = wait_for(client, job_id, lambda j: j["status"] in terminal)
        if mode == "manual":
            assert job["status"] == "awaiting_review", job
            assert job["progress"] == 45
            assert not job["result"].get("recognition_review")
            assert not (tmp_path / "jobs" / job_id / "model.glb").exists()
            from backend.tests.test_structure_review import payload
            assert client.post(f"/api/jobs/{job_id}/confirm-structure", json=payload(client, job)).status_code == 200
            job = wait_for(client, job_id, lambda j: j["status"] in terminal)
        assert job["status"] == "succeeded", job
        assert job["result"]["consistency"]["source_reviewed"] == (mode == "manual")
        layout = client.get(job["result"]["layout_url"]).json()
        assert layout["walls"][0]["end"]["x"] == 8
        if overshoot == 0.06:
            assert any("6.0 厘米" in note for note in job["result"]["warnings"])
        else:
            assert any(a["role"] == "geometry_recovery" for a in job["result"]["agents"])


def test_unrecoverable_geometry_cannot_be_built(tmp_path):
    ai = InvalidGeometry()
    ai.overshoot = 1
    with TestClient(app_for(tmp_path, ai)) as client:
        job_id = upload(client)
        job = wait_for(client, job_id, lambda j: j["status"] in {"failed", "succeeded", "awaiting_review"})
        assert job["status"] == "failed", job
        assert not (tmp_path / "jobs" / job_id / "model.glb").exists()


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
