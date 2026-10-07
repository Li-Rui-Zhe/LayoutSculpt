import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.consistency import structure_hash
from backend.app.main import create_app
from backend.app.modeling import build_model
from backend.app.quality import prepare_generated_furnishing, furnishing_issues
from backend.app.schemas import Furnishing, Layout, validate_furnishing
from backend.tests.test_workflow import FakeCodex, create_job, fake_builder, furniture_data, layout_data, wait_job


def test_minor_furniture_penetration_is_repaired_locally_without_changing_architecture():
    layout = Layout.model_validate(layout_data())
    original_hash = structure_hash(layout)
    data = furniture_data()
    data["items"][0].update(x=4, y=0.46)
    plan = Furnishing.model_validate(data)
    prepared = prepare_generated_furnishing(plan, layout)
    assert len(prepared.items) == 1
    assert prepared.items[0].y > plan.items[0].y
    assert prepared.items[0].y - plan.items[0].y <= 0.25
    assert not furnishing_issues(prepared, layout)
    assert "已微调" in "；".join(prepared.notes)
    assert plan.items[0].y == 0.46
    assert structure_hash(layout) == original_hash


def test_impossible_piece_is_omitted_with_note_and_other_furniture_survives():
    layout = Layout.model_validate(layout_data())
    data = furniture_data()
    data["items"].append({**data["items"][0], "name": "越界装饰", "kind": "plant", "room_id": "unknown", "x": 30, "y": 30})
    prepared = prepare_generated_furnishing(Furnishing.model_validate(data), layout)
    assert len(prepared.items) == 1
    assert validate_furnishing(prepared, layout) is prepared
    assert "暂未放置越界装饰" in "；".join(prepared.notes)


def test_unusual_dimensions_are_advice_and_valid_coordinates_keep_full_precision():
    layout = Layout.model_validate(layout_data())
    data = furniture_data()
    data["items"][0].update(kind="bed", x=2.123456789, width=0.8, depth=1.7, height=0.3)
    prepared = prepare_generated_furnishing(Furnishing.model_validate(data), layout)
    assert prepared.items[0].x == 2.123456789
    assert prepared.items[0].width == 0.8
    assert "基本使用要求" in "；".join(prepared.notes)


class FurnitureProblemCodex(FakeCodex):
    def __init__(self, problem):
        super().__init__()
        self.problem = problem

    async def generate(self, **kwargs):
        result = await super().generate(**kwargs)
        if kwargs["schema"]["title"] != "Furnishing":
            return result
        if self.problem == "timeout":
            raise TimeoutError("家具规划测试超时")
        if self.problem == "malformed":
            return "{broken JSON"
        data = json.loads(result)
        if self.problem == "minor":
            data["items"][0].update(x=4, y=0.46)
        if self.problem == "unplaceable":
            data["items"][0].update(x=30, y=30)
        return json.dumps(data)


@pytest.mark.parametrize("problem", ["minor", "unplaceable", "timeout", "malformed"])
def test_furniture_issues_do_not_block_confirmed_structure_delivery(tmp_path, problem):
    codex = FurnitureProblemCodex(problem)
    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(create_app(settings, client=codex, model_builder=fake_builder)) as client:
        final = wait_job(client, create_job(client)["id"])
        assert final["status"] == "succeeded", final
        result = final["result"]
        assert result["consistency"]["source_reviewed"]
        delivered = client.get(result["layout_url"]).json()
        assert structure_hash(delivered) == result["consistency"]["confirmation"]["structure_hash"]
        calls = [call for call in codex.calls if call["schema"]["title"] == "Furnishing"]
        assert len(calls) == (2 if problem == "malformed" else 1)
        if problem == "minor":
            assert result["delivery_status"] == "ready"
            assert not result["delivery_notice"]
            assert len(delivered["furniture"]) == 1
        else:
            assert result["delivery_status"] == "structure_ready"
            assert result["delivery_notice"]
            assert not result["quality"]["furnishing_complete"]
            assert not delivered["furniture"]
            assert len(delivered["walls"]) == 4
            assert len(delivered["openings"]) == 1


def test_furniture_timeout_still_delivers_actual_verified_glb(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(create_app(settings, client=FurnitureProblemCodex("timeout"), model_builder=build_model)) as client:
        final = wait_job(client, create_job(client)["id"])
        assert final["status"] == "succeeded", final
        result = final["result"]
        assert result["delivery_status"] == "structure_ready"
        assert client.get(result["model_url"]).content[:4] == b"glTF"
        assert result["consistency"]["geometry_verified"]
        assert result["consistency"]["outline_verified"]
        assert result["consistency"]["source_reviewed"]
