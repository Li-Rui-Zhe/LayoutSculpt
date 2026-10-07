import copy

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.schemas import ManualEditRequest
from backend.tests.test_workflow import (
    FakeCodex,
    app_for,
    create_job,
    wait_job,
    layout_data,
    furniture_data,
)


def document():
    return {
        "name": "人工设计验收",
        "layout": layout_data(),
        "furniture": furniture_data(),
    }


def test_all_objects_can_be_removed_and_lights_furniture_changes_persist(tmp_path):
    codex = FakeCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        source = wait_job(client, create_job(client)["id"])
        count = len(codex.calls)
        body = document()
        body["furniture"]["items"][0].update(name="阅读沙发", rotation=30)
        body["layout"]["rooms"][0]["floor_enabled"] = False
        body["layout"]["lights"] = [
            {
                "id": "lamp",
                "name": "阅读灯",
                "kind": "floor_lamp",
                "x": 3,
                "y": 3,
                "elevation": 1.6,
                "lumens": 900,
                "temperature": 2700,
                "enabled": True,
            }
        ]
        body["layout"]["openings"][0].update(hinge="end", swing="right", angle=45)
        edited = client.post(f"/api/jobs/{source['id']}/edit", json=body)
        assert edited.status_code == 201, edited.text
        result = wait_job(client, edited.json()["id"])
        assert result["status"] == "succeeded", result
        data = client.get(f"/api/jobs/{result['id']}/artifacts/layout.json").json()
        assert data["lights"][0]["lumens"] == 900
        assert data["rooms"][0]["floor_enabled"] is False
        assert data["furniture"][0]["name"] == "阅读沙发"
        assert data["openings"][0]["angle"] == 45
        body["layout"].update(rooms=[], walls=[], openings=[], lights=[])
        body["furniture"]["items"] = []
        removed = client.post(f"/api/jobs/{result['id']}/edit", json=body)
        assert removed.status_code == 201, removed.text
        assert wait_job(client, removed.json()["id"])["status"] == "succeeded"
        assert len(codex.calls) == count


@pytest.mark.parametrize(
    "case",
    [
        "rooms_overlap",
        "duplicate_wall",
        "outside_wall",
        "lamp_outside",
        "duplicate_lamp",
        "nan",
        "dangling_furniture",
    ],
)
def test_manual_design_strict_validation(case):
    body = document()
    if case == "rooms_overlap":
        room = copy.deepcopy(body["layout"]["rooms"][0])
        room["id"] = "overlap"
        body["layout"]["rooms"].append(room)
    elif case == "duplicate_wall":
        wall = copy.deepcopy(body["layout"]["walls"][0])
        wall["id"] = "duplicate"
        body["layout"]["walls"].append(wall)
    elif case == "outside_wall":
        body["layout"]["walls"][1]["end"] = {"x": 9, "y": 6}
    elif case in {"lamp_outside", "duplicate_lamp"}:
        lamp = {
            "id": "a",
            "name": "灯泡",
            "kind": "bulb",
            "x": 9 if case == "lamp_outside" else 2,
            "y": 1,
        }
        body["layout"]["lights"] = (
            [lamp] if case == "lamp_outside" else [lamp, dict(lamp)]
        )
    elif case == "nan":
        body["furniture"]["items"][0]["rotation"] = float("nan")
    else:
        body["layout"]["rooms"] = []
    with pytest.raises(ValidationError):
        ManualEditRequest.model_validate(body)


def test_concave_room_rejects_furniture_crossing_gap_even_with_corners_inside():
    body = document()
    body["layout"]["rooms"][0]["polygon"] = [
        {"x": x, "y": y}
        for x, y in [(0, 0), (6, 0), (6, 6), (4, 6), (4, 2), (3, 2), (3, 6), (0, 6)]
    ]
    body["furniture"]["items"][0].update(x=2.75, y=4, width=4.5, depth=1)
    with pytest.raises(ValidationError, match="凹形"):
        ManualEditRequest.model_validate(body)


def test_rebuilding_manual_design_does_not_reintroduce_deleted_lights(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        source = wait_job(client, create_job(client)["id"])
        body = document()
        body["layout"]["lights"] = []
        edited = client.post(f"/api/jobs/{source['id']}/edit", json=body)
        manual = wait_job(client, edited.json()["id"])
        rebuilt = client.post(f"/api/jobs/{manual['id']}/rebuild")
        result = wait_job(client, rebuilt.json()["id"])
        assert result["status"] == "succeeded", result
        data = client.get(result["result"]["layout_url"]).json()
        assert not data["lights"]
        assert result["result"]["design_mode"] == "manual"
