"""Image-space registration, independent comparisons and precise workflow."""

import asyncio
import json
from dataclasses import replace
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from backend.app.codex import CodexClient
from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.source_evidence import (
    DetailRegion,
    ImageLabel,
    SourceEvidence,
    alignment_from_evidence,
    compare_source,
    detail_views,
    image_wall_findings,
    validate_evidence,
)
from backend.tests.test_progressive_generation import upload, wait_for
from backend.tests.test_workflow import (
    FakeCodex,
    app_for,
    fake_builder,
    layout_data,
    wait_job,
)


def evidence():
    return SourceEvidence.model_validate({
        "input_check": {"status": "usable", "reason": "none", "evidence": "建筑外边界和墙线可辨认"},
        "outline_px": [[20, 10], [180, 10], [180, 130], [20, 130]],
        "walls_px": [{"a": a, "b": b} for a, b in [([20, 10], [180, 10]), ([180, 10], [180, 130]), ([180, 130], [20, 130]), ([20, 130], [20, 10])]],
        "labels": [{"name": "客厅", "kind": "living", "point": [100, 70], "certainty": "clear"}],
        "dimensions": [{"a": [20, 10], "b": [180, 10], "meters": 8, "evidence": "上方尺寸跨度八米"}],
        "regions": [], "warnings": [],
    })


def test_registration_uses_one_scale_and_missing_dimensions_require_confirmation():
    source = evidence()
    alignment = alignment_from_evidence(source, (200, 150))
    assert alignment["origin_px"] == [20, 10]
    assert alignment["meters_per_pixel"] == pytest.approx(0.05)
    result = compare_source(layout_data(), source, alignment)
    assert result["outline_overlap"] == 1
    assert not result["findings"]
    source.dimensions = []
    estimated = alignment_from_evidence(source, (200, 150))
    assert estimated["scale_uncertain"]
    assert "10 米估算" in estimated["warnings"][0]
    assert any(f["code"] == "scale_uncertain" for f in compare_source(layout_data(), source, estimated)["findings"])


def test_comparison_catches_filled_concavity_extra_bedroom_and_missing_kitchen():
    source = evidence()
    alignment = alignment_from_evidence(source, (200, 150))
    source.outline_px = [[20, 10], [100, 10], [100, 70], [180, 70], [180, 130], [20, 130]]
    source.labels = [ImageLabel.model_validate(value) for value in [
        {"name": "卧室", "kind": "bedroom", "point": [50, 90], "certainty": "clear"},
        {"name": "厨房", "kind": "kitchen", "point": [70, 60], "certainty": "clear"},
    ]]
    findings = compare_source(layout_data(), source, alignment)["findings"]
    assert {f["code"] for f in findings} >= {"outline_mismatch", "bedroom_count", "room_position"}
    assert any("厨房" in f["message"] for f in findings)


def test_image_bounds_and_local_crop_mapping_are_checked_without_redrawing(tmp_path):
    source = evidence()
    source.regions = [DetailRegion(box=[30, 20, 90, 80], reason="门窗密集需要细读")]
    validate_evidence(source, (200, 150))
    image = Image.new("RGB", (200, 150), "white")
    image.putpixel((30, 20), (1, 2, 3))
    path = tmp_path / "source.png"
    image.save(path)
    before = path.read_bytes()
    paths, views = detail_views(path, tmp_path, source)
    left, top, right, bottom = views[0]["box"]
    with Image.open(paths[0]) as crop:
        assert crop.size == (right - left, bottom - top)
        assert crop.getpixel((30 - left, 20 - top)) == (1, 2, 3)
    assert path.read_bytes() == before
    source.outline_px[0] = [201, 10]
    with pytest.raises(ValueError, match="超出图片"):
        validate_evidence(source, (200, 150))


class PreciseReader(FakeCodex):
    wrong_audit = False
    rejected = False
    invalid_pixels = False

    async def generate(self, **kwargs):
        result = await super().generate(**kwargs)
        if kwargs["schema"]["title"] == "SourceEvidence":
            data = json.loads(result)
            audit = "不参考之前的识别结果" in kwargs["prompt"]
            assert "请凭空增加一个房间" not in kwargs["prompt"]
            if self.rejected:
                data.update(input_check={"status": "rejected", "reason": "not_floorplan", "evidence": "图片只有人物没有墙体"}, outline_px=[], walls_px=[], labels=[], dimensions=[], regions=[])
            elif audit and self.wrong_audit:
                data["labels"][0].update(name="原图卧室", kind="bedroom")
            elif not audit:
                data["regions"] = [{"box": [10, 10, 70, 60], "reason": "此区域门窗需要细读"}]
            return json.dumps(data)
        if kwargs["schema"]["title"] == "PixelLayoutExtraction":
            assert len(kwargs["reference_images"]) == 1
            assert "image_views" in kwargs["prompt"]
            if self.invalid_pixels:
                data = json.loads(result)
                data["walls"][0]["b"][0] += 0.6
                return json.dumps(data)
        return result


def test_precise_workflow_independent_read_and_user_confirmation(tmp_path):
    ai = PreciseReader()
    with TestClient(app_for(tmp_path, ai)) as client:
        job_id = upload(client, recognition_mode="precise", review_mode="manual", notes="请凭空增加一个房间")
        job = wait_for(client, job_id, lambda j: j["status"] in {"awaiting_review", "failed"})
        assert job["status"] == "awaiting_review", job
        assert [call["schema"]["title"] for call in ai.calls] == ["SourceEvidence", "PixelLayoutExtraction", "SourceEvidence"]
        alignment = client.get(job["result"]["source_alignment_url"]).json()
        assert alignment["independent_review"]
        assert not alignment["findings"]
        assert alignment["views"][0]["image_index"] == 2
        assert job["result"]["ai_review"]["method"] == "independent_source_comparison"
        assert wait_job(client, job_id)["status"] == "succeeded"
        assert len(ai.calls) == 4


def test_independent_disagreement_pauses_default_preview_instead_of_building(tmp_path):
    ai = PreciseReader()
    ai.wrong_audit = True
    with TestClient(app_for(tmp_path, ai)) as client:
        job_id = upload(client, recognition_mode="precise")
        job = wait_for(client, job_id, lambda j: j["status"] in {"awaiting_review", "failed", "succeeded"})
        assert job["status"] == "awaiting_review", job
        assert job["result"]["ai_review"]["status"] == "needs_review"
        assert "卧室" in job["result"]["ai_review"]["summary"]
        assert len(ai.calls) == 3
        assert not (tmp_path / "jobs" / job_id / "model.glb").exists()


def test_rejected_source_does_not_invoke_detail_recognition(tmp_path):
    ai = PreciseReader()
    ai.rejected = True
    with TestClient(app_for(tmp_path, ai)) as client:
        job_id = upload(client, recognition_mode="precise")
        job = wait_for(client, job_id, lambda j: j["status"] == "failed")
        assert job["result"]["failure"]["code"] == "input_image_rejected"
        assert len(ai.calls) == 1


def test_pixel_geometry_failure_preserves_registration_and_two_attempts(tmp_path):
    ai = PreciseReader()
    ai.invalid_pixels = True
    with TestClient(app_for(tmp_path, ai)) as client:
        job_id = upload(client, recognition_mode="precise")
        job = wait_for(client, job_id, lambda j: j["status"] in {"awaiting_review", "failed"})
        assert job["status"] == "awaiting_review", job
        checkpoint = job["result"]["recognition_review"]
        assert len(checkpoint["attempts"]) == 2
        assert checkpoint["can_continue"]
        assert client.get(job["result"]["source_alignment_url"]).status_code == 200
        assert len(ai.calls) == 3


def test_repair_timeout_keeps_first_displayable_pixel_candidate(tmp_path):
    class SlowRepair(PreciseReader):
        pixel_calls = 0

        async def generate(self, **kwargs):
            if kwargs["schema"]["title"] == "PixelLayoutExtraction":
                self.pixel_calls += 1
                if self.pixel_calls > 1:
                    await asyncio.sleep(2)
            return await super().generate(**kwargs)

    ai = SlowRepair()
    ai.invalid_pixels = True
    app = create_app(replace(Settings(), data_dir=tmp_path, codex_timeout=0.5), client=ai, model_builder=fake_builder)
    with TestClient(app) as client:
        job_id = upload(client, recognition_mode="precise")
        job = wait_for(client, job_id, lambda j: j["status"] in {"awaiting_review", "failed"})
        assert job["status"] == "awaiting_review", job
        attempts = job["result"]["recognition_review"]["attempts"]
        assert len(attempts) == 2
        assert "修正请求未能完成" in attempts[-1]["issues"][0]


def test_unclear_bedroom_labels_do_not_impose_a_false_exact_count():
    source = evidence()
    source.labels = [ImageLabel(name="卧室", kind="bedroom", point=[50, 50], certainty="clear"),
                     ImageLabel(name="疑似卧室", kind="bedroom", point=[100, 90], certainty="uncertain")]
    findings = compare_source(layout_data(), source, alignment_from_evidence(source, (200, 150)))["findings"]
    assert not any(f["code"] == "bedroom_count" for f in findings)


def test_precise_mode_can_automatically_continue_when_comparisons_have_no_findings(tmp_path):
    ai = PreciseReader()
    with TestClient(app_for(tmp_path, ai)) as client:
        job_id = upload(client, recognition_mode="precise")
        job = wait_for(client, job_id, lambda j: j["status"] in {"succeeded", "failed", "awaiting_review"})
        assert job["status"] == "succeeded", job
        assert not job["result"]["consistency"]["source_reviewed"]
        assert len(ai.calls) == 4


def test_source_ink_hints_find_blank_wall_positions_but_skip_openings_and_glass(tmp_path):
    image = Image.new("RGB", (220, 160), "white")
    draw = ImageDraw.Draw(image)
    draw.line([(20, 140), (20, 20), (180, 20)], fill="black", width=5)
    draw.line([(20, 140), (180, 140)], fill="black", width=5)
    source = tmp_path / "ink.png"
    image.save(source)
    layout = layout_data()
    frame = {"origin_px": [20, 20], "meters_per_pixel": 0.05}
    findings = image_wall_findings(source, layout, frame)
    assert [f["wall_id"] for f in findings] == ["w1"]
    assert findings[0]["blocking"]
    layout["openings"].append({"wall_id": "w1", "offset": 0, "width": 6})
    assert not image_wall_findings(source, layout, frame)
    layout["openings"].pop()
    layout["walls"][1]["boundary_type"] = "glazing"
    assert not image_wall_findings(source, layout, frame)


def test_deepseek_transmits_whole_image_before_original_resolution_crops(tmp_path):
    from backend.tests.test_ai_connections import VISION, connection_app, enable
    app, _, calls = connection_app(tmp_path)
    paths = []
    for index, size in enumerate([(120, 90), (40, 30)]):
        path = tmp_path / f"input-{index}.png"
        Image.new("RGB", size).save(path)
        paths.append(path)
    with TestClient(app) as client:
        enable(client)
        remote = app.state.ai_client.remote
        asyncio.run(remote.generate(image=paths[0], reference_images=paths[1:], prompt="读取图片", instructions="结构数据", schema={"title": "LayoutExtraction"}, model=VISION))
        payload = json.loads(calls[-1].content)
        parts = payload["messages"][1]["content"]
        assert [part["type"] for part in parts] == ["text", "image_url", "image_url"]
        import base64
        for part, size in zip(parts[1:], [(120, 90), (40, 30)]):
            assert part["image_url"]["detail"] == "original"
            with Image.open(BytesIO(base64.b64decode(part["image_url"]["url"].split(",", 1)[1]))) as image:
                assert image.size == size


def test_explicit_reidentify_does_not_reuse_valid_but_unaccepted_perception_cache(tmp_path):
    ai = PreciseReader()
    ai.wrong_audit = True
    with TestClient(app_for(tmp_path, ai)) as client:
        old_id = upload(client, recognition_mode="precise")
        wait_for(client, old_id, lambda j: j["status"] == "awaiting_review")
        before = len(ai.calls)
        response = client.post(f"/api/jobs/{old_id}/retry", json={"reidentify": True})
        assert response.status_code == 201, response.text
        new_id = response.json()["id"]
        new = wait_for(client, new_id, lambda j: j["status"] == "awaiting_review")
        assert new["reidentify_of"] == old_id
        assert len(ai.calls) == before + 3
        assert all(not stage["cache_hit"] for stage in new["result"]["pipeline_metrics"]["stages"])
        assert client.get(f"/api/jobs/{old_id}").json()["status"] == "awaiting_review"


def test_continuing_a_reidentify_job_reuses_its_own_completed_evidence(tmp_path):
    class InterruptedPixels(PreciseReader):
        interrupt = False

        async def generate(self, **kwargs):
            if self.interrupt and kwargs["schema"]["title"] == "PixelLayoutExtraction":
                raise RuntimeError("authentication failed 401")
            return await super().generate(**kwargs)

    ai = InterruptedPixels()
    with TestClient(app_for(tmp_path, ai)) as client:
        old_id = upload(client, recognition_mode="precise", review_mode="manual")
        wait_for(client, old_id, lambda j: j["status"] == "awaiting_review")
        ai.interrupt = True
        response = client.post(f"/api/jobs/{old_id}/retry", json={"reidentify": True})
        new_id = response.json()["id"]
        failed = wait_for(client, new_id, lambda j: j["status"] == "failed")
        before = sum(c["schema"]["title"] == "SourceEvidence" for c in ai.calls)
        ai.interrupt = False
        response = client.post(f"/api/jobs/{new_id}/continue", json={"revision": failed["updated_at"]})
        assert response.status_code == 200, response.text
        recovered = wait_for(client, new_id, lambda j: j["status"] in {"awaiting_review", "failed"})
        assert recovered["status"] == "awaiting_review", recovered
        assert sum(c["schema"]["title"] == "SourceEvidence" for c in ai.calls) == before + 1  # only the independent audit is new
        stages = recovered["result"]["pipeline_metrics"]["stages"]
        assert any(s["role"] == "source_evidence" and s["cache_hit"] for s in stages)


@pytest.mark.asyncio
async def test_local_codex_keeps_original_and_crop_order_in_image_inputs(tmp_path):
    client = CodexClient(Settings())
    captured = []

    async def started():
        pass

    async def request(method, params, timeout=60):
        if method == "config/read":
            return {"config": {}}
        if method == "thread/start":
            return {"thread": {"id": "source-test"}, "model": "chosen"}
        if method == "turn/start":
            captured.extend(params["input"])
            queue = client.threads["source-test"]
            queue.put_nowait({"method": "item/completed", "params": {"threadId": "source-test", "turnId": "turn", "item": {"id": "result", "type": "agentMessage", "text": '{"ok":true}'}}})
            queue.put_nowait({"method": "turn/completed", "params": {"threadId": "source-test", "turn": {"id": "turn", "status": "completed"}}})
            return {"turn": {"id": "turn"}}
        return {}

    client.ensure_started, client.request = started, request
    paths = [tmp_path / name for name in ("source.png", "crop-a.png", "crop-b.png")]
    result = await client.generate(workspace=tmp_path, image=paths[0], reference_images=paths[1:], prompt="只读取原图", instructions="结构数据", schema={}, model="chosen")
    assert json.loads(result) == {"ok": True}
    assert [item["path"] for item in captured if item["type"] == "localImage"] == [str(path) for path in paths]
