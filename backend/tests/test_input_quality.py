import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.input_quality import InputCheck, SourceImageRejected
from backend.app.recognition_contract import RecognitionExtraction, validate_recognition
from backend.app.ai_contracts import pack_layout
from backend.app.schemas import Layout
from backend.tests.test_workflow import FakeCodex, app_for, create_job, wait_job, layout_data


class ImageCheckClient(FakeCodex):
    def __init__(self, check):
        super().__init__()
        self.check = check

    async def generate(self, **kwargs):
        raw = await super().generate(**kwargs)
        if kwargs["schema"]["title"] != "LayoutExtraction":
            return raw
        output = json.loads(raw)
        if self.check is None:
            output.pop("input_check", None)
        else:
            output["input_check"] = self.check
            if self.check["status"] == "rejected":
                output.update(title="请更换户型图", outline=[], rooms=[], walls=[], openings=[])
        return json.dumps(output)


@pytest.mark.parametrize("reason", ["not_floorplan", "severe_blur", "cropped_structure", "unreadable"])
def test_rejected_image_stops_before_review_furniture_and_model(tmp_path, reason):
    check = {"status": "rejected", "reason": reason, "evidence": "原图的主要住宅边界无法辨认"}
    ai = ImageCheckClient(check)
    with TestClient(app_for(tmp_path, ai)) as client:
        original = create_job(client)
        job = wait_job(client, original["id"])
        assert job["status"] == "failed"
        assert job["stage"] == "请更换户型图"
        assert job["result"]["input_check"] == check
        assert job["result"]["failure"]["code"] == "input_image_rejected"
        assert job["options"] == original["options"]
        assert len(ai.calls) == 1  # 不进行纠错重试、复核或家具规划
        assert client.get(job["source_url"]).status_code == 200
        assert client.post(f"/api/jobs/{job['id']}/continue", json={"revision": job["updated_at"]}).status_code == 409
        assert not list(tmp_path.rglob("model.glb"))
        assert not list(tmp_path.rglob("recognition.json"))


def test_readable_handdrawn_without_dimensions_continues(tmp_path):
    ai = ImageCheckClient({"status": "usable", "reason": "none", "evidence": "手绘图虽无尺寸，但完整边界及房间墙线清晰可辨"})
    with TestClient(app_for(tmp_path, ai)) as client:
        job = wait_job(client, create_job(client)["id"])
        assert job["status"] == "succeeded", job.get("error")
        assert any(call["schema"]["title"] == "Furnishing" for call in ai.calls)


def test_missing_check_cannot_bypass_gate(tmp_path):
    ai = ImageCheckClient(None)
    with TestClient(app_for(tmp_path, ai)) as client:
        job = wait_job(client, create_job(client)["id"])
        assert job["status"] == "failed"
        assert len(ai.calls) == 2  # 只允许修正一次缺失契约
        assert not list(tmp_path.rglob("recognition.json"))


def test_conflicting_assessment_and_empty_usable_geometry_are_invalid():
    with pytest.raises(ValidationError):
        InputCheck(status="usable", reason="severe_blur", evidence="无法辨认主要墙线")
    data = pack_layout(Layout.model_validate(layout_data()))
    data.update(input_check={"status": "usable", "reason": "none", "evidence": "主要墙线和空间边界可见"}, outline=[])
    with pytest.raises(ValueError):
        validate_recognition(RecognitionExtraction.model_validate(data))
    data["input_check"] = {"status": "rejected", "reason": "severe_blur", "evidence": "无法辨认主要墙线"}
    with pytest.raises(SourceImageRejected):
        validate_recognition(RecognitionExtraction.model_validate(data))
