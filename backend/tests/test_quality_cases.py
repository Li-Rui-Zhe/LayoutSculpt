import json
import pytest
from PIL import Image
from scripts.quality_cases import load_quality_cases


def dataset(tmp_path):
    Image.new("RGB", (64, 64), "white").save(tmp_path / "plan.png")
    expected = {"outline": [[0, 0], [4, 0], [4, 3], [0, 3]], "area": 12,
                "bedrooms": 0, "windows": 1, "doors": 1,
                "room_points": [["living", 2, 1]], "opening_points": [["window", 2, 0]]}
    value = {"cases": [{"id": "apartment", "image": "plan.png", "annotation": "human_verified",
                         "origin": "test_fixture", "expected": expected}]}
    path = tmp_path / "cases.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    return path, value


def test_resume_requires_same_source_and_annotation(tmp_path):
    path, value = dataset(tmp_path)
    folder = tmp_path / "run"
    result = load_quality_cases(path, folder)
    assert result["apartment"]["area"] == 12
    assert load_quality_cases(path, folder) == result
    before = (folder / "apartment.png").read_bytes()
    Image.new("RGB", (64, 64), "black").save(tmp_path / "plan.png")
    with pytest.raises(ValueError, match="已变化"):
        load_quality_cases(path, folder)
    assert (folder / "apartment.png").read_bytes() == before


def test_requires_reviewed_unique_cases(tmp_path):
    path, value = dataset(tmp_path)
    value["cases"][0]["annotation"] = "ai_confidence"
    path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(ValueError, match="人工"):
        load_quality_cases(path, tmp_path / "run")
    value["cases"][0]["annotation"] = "human_verified"
    value["cases"].append(value["cases"][0])
    path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(ValueError, match="唯一"):
        load_quality_cases(path, tmp_path / "run")
