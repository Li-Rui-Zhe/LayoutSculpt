import json
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from PIL import Image

from backend.app.floorplan_evidence import (
    compare_floorplan_mask,
    run_floorplan_evidence,
    select_wall_repair_targets,
)
from backend.app.floorplan_inference import main as run_worker


@pytest.mark.parametrize("device_args", [[], ["--device", "auto"], ["--device", "cpu"]])
def test_worker_only_uses_cpu_with_legacy_options(
    device_args, tmp_path, monkeypatch, capsys
):
    source, output = tmp_path / "source.png", tmp_path / "mask.png"
    Image.new("RGB", (128, 128), "white").save(source)
    runtime = Mock()
    session = runtime.InferenceSession.return_value
    session.get_providers.return_value = ["CPUExecutionProvider"]
    session.get_inputs.return_value = [
        SimpleNamespace(type="tensor(float)", shape=[1, 3, 128, 128], name="image")
    ]
    logits = np.zeros((1, 4, 128, 128), dtype=np.float32)
    logits[:, 1] = 10
    session.run.return_value = [logits]
    monkeypatch.setitem(sys.modules, "onnxruntime", runtime)
    monkeypatch.setenv("STUDIO_FLOORPLAN_DEVICE", "auto")
    monkeypatch.setattr(
        sys, "argv", ["worker", "model.onnx", str(source), str(output), *device_args]
    )

    run_worker()

    runtime.InferenceSession.assert_called_once_with(
        "model.onnx",
        sess_options=runtime.SessionOptions.return_value,
        providers=["CPUExecutionProvider"],
    )
    assert json.loads(capsys.readouterr().out)["provider"] == "CPUExecutionProvider"
    with Image.open(output) as mask:
        assert mask.mode == "P" and np.all(np.asarray(mask) == 1)


def test_missing_model_or_runtime_leaves_existing_recognition_usable(
    tmp_path, monkeypatch
):
    model = tmp_path / "structure.onnx"
    monkeypatch.setenv("STUDIO_FLOORPLAN_MODEL", str(model))
    monkeypatch.setenv("STUDIO_FLOORPLAN_PYTHON", str(tmp_path / "missing-python"))
    source = tmp_path / "source.png"
    Image.new("RGB", (128, 128), "white").save(source)
    assert run_floorplan_evidence(tmp_path, source) is None
    model.touch()
    assert run_floorplan_evidence(tmp_path, source) is None


def test_opening_requires_positive_disagreement_and_cannot_block():
    mask = np.zeros((128, 128), dtype=np.uint8)
    layout = {
        "walls": [{"id": "W1", "start": {"x": 0, "y": 1}, "end": {"x": 10, "y": 1}}],
        "openings": [{"wall_id": "W1", "offset": 2, "width": 4, "kind": "window"}],
    }
    alignment = {
        "origin_px": [20, 10],
        "meters_per_pixel": 0.1,
        "image_width": 256,
        "image_height": 128,
    }
    assert compare_floorplan_mask(mask, layout, alignment) == []
    mask[18:23, 20:41] = 1
    (finding,) = compare_floorplan_mask(mask, layout, alignment)
    assert finding["blocking"] is False
    assert finding["box"] == [32, 16, 88, 24]
    serializer = JsonPlusSerializer()
    assert serializer.loads_typed(serializer.dumps_typed(finding)) == finding
    mask[18:23, 20:41] = 2
    assert compare_floorplan_mask(mask, layout, alignment) == []


def test_wall_repair_keeps_real_gaps_and_defers_apertures_and_nearby_strokes():
    mask = np.zeros((180, 200), dtype=np.uint8)
    frame = {
        "origin_px": [0, 0],
        "meters_per_pixel": 0.025,
        "image_width": 200,
        "image_height": 180,
    }
    layout = {
        "walls": [
            {
                "start": {"x": 0.5, "y": y * 0.025},
                "end": {"x": 4.5, "y": y * 0.025},
                "thickness": 0.15,
            }
            for y in (20, 40, 70)
        ]
    }
    for y in (20, 40, 70, 100):
        mask[y - 2 : y + 3, 20:181] = 1
    mask[148:153, 20:181] = 3
    findings = [
        {"span_px": [[25, y], [175, y]], "blocking": True} for y in (44, 100, 125, 150)
    ]

    targets, manual = select_wall_repair_targets(mask, layout, frame, findings)
    assert targets == [findings[1]]
    assert [f["reason"] for f in manual] == [
        "near_existing_wall",
        "unconfirmed_wall",
        "opening_supported",
    ]
    assert all(f["blocking"] for f in manual)

    mask[:75] = 0
    targets, _ = select_wall_repair_targets(mask, layout, frame, findings)
    assert targets == findings[1:3]

    layout["walls"][1]["thickness"] = 0.25
    mask[29:52, 78:83] = 1
    perpendicular = {"span_px": [[80, 29], [80, 51]], "blocking": True}
    targets, _ = select_wall_repair_targets(mask, layout, frame, [perpendicular])
    assert targets == [perpendicular]


def test_crop_budget_keeps_cloud_context_and_flags_strong_disagreements():
    from backend.app.opening_review import cloud_opening_context, plan_opening_review
    from backend.app.source_evidence import DetailRegion, ImageOpening
    from backend.tests.test_source_evidence import evidence

    original = evidence()
    original.regions = [
        DetailRegion(box=coords, reason="原图区域待复核")
        for coords in ([20, 20, 100, 90], [20, 100, 60, 140], [150, 50, 190, 100])
    ]
    original.openings_px = [
        ImageOpening(kind="door", a=[45, 30], b=[75, 30], certainty="clear")
    ]
    mask = np.zeros((150, 200), dtype=np.uint8)
    mask[29:33, 44:77] = 2
    mask[125:130, 105:125] = 3
    regions, report, deferred = plan_opening_review(original, mask, (200, 150))
    assert regions == original.regions
    assert report["new_crop_count"] == 0
    assert deferred == {0}
    assert report["possible_missing_count"] == 1
    assert [hint["hypothesis"] for hint in cloud_opening_context(report)] == [
        "本地像素支持窗"
    ]

    original.regions = original.regions[:1]
    regions, report, deferred = plan_opening_review(original, mask, (200, 150))
    assert regions[0] == original.regions[0]
    assert len(regions) == 2
    assert report["new_crop_count"] == 1
    assert report["selected_count"] == 2
    assert deferred == {0}


def test_outer_edge_hints_are_independent_in_each_axis():
    from backend.app.opening_review import outline_pixel_context
    from backend.tests.test_source_evidence import evidence

    original = evidence()
    mask = np.zeros((150, 200), dtype=np.uint8)
    mask[9:12, 19:182] = 1
    mask[128:131, 19:182] = 1
    mask[9:131, 19:22] = 1
    mask[9:131, 179:182] = 1
    assert outline_pixel_context(original, mask, (200, 150)) == {}

    original.outline_px = [[20, 10], [145, 10], [145, 105], [20, 105]]
    report = outline_pixel_context(original, mask, (200, 150))
    assert set(report) == {"horizontal", "vertical"}
    assert report["horizontal"][0]["local_bounds_px"] == [19, 182]
    assert report["vertical"][0]["local_bounds_px"] == [9, 131]


def test_mixed_disagreements_go_to_manual_review_when_no_local_correction_is_supported():
    from backend.app.opening_review import needs_manual_structure_review

    conflict = {
        "outline_overlap": 0.88,
        "findings": [
            {"code": code, "blocking": True}
            for code in ["opening_mismatch"] * 3
            + ["missing_wall"] * 2
            + ["wall_position"]
        ],
    }
    assert needs_manual_structure_review(conflict, [])
    assert not needs_manual_structure_review(
        conflict, [{"code": "local_opening_disagreement"}]
    )
    assert not needs_manual_structure_review({**conflict, "outline_overlap": 0.96}, [])
    assert not needs_manual_structure_review(
        {**conflict, "findings": conflict["findings"][:-1]}, []
    )


def test_pixel_recognition_defaults_an_unknown_wall_finish_and_checks_geometry():
    from pydantic import ValidationError

    from backend.app.source_evidence import PixelWall

    wall = {"a": [0, 0], "b": [20, 0], "ext": True, "h": 2.8, "id": "w1", "t": 4}
    assert PixelWall.model_validate({**wall, "finish": "tile"}).finish == "default"
    assert PixelWall.model_validate({**wall, "finish": "sage"}).finish == "sage"
    with pytest.raises(ValidationError):
        PixelWall.model_validate({**wall, "t": 0, "finish": "tile"})
