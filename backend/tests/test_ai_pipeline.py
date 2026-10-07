import json
import time
from copy import deepcopy
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from backend.app.ai_cache import StageCache, compact_json
from backend.app.ai_contracts import (
    CHECKS,
    LayoutReviewPatch,
    apply_review_patch,
    pack_layout,
    unpack_layout,
)
from backend.app.config import Settings
from backend.app.consistency import structure_hash
from backend.app.main import create_app
from backend.app.schemas import Layout
from backend.tests.test_structure_review import pending
from backend.tests.test_workflow import (
    FakeCodex,
    create_job,
    fake_builder,
    image_bytes,
    layout_data,
)


def canonical_layout():
    data = layout_data()
    data["walls"][0]["finish"] = "sage"
    data["rooms"][0]["floor_finish"] = "stone"
    data["openings"][0].update(hinge="end", swing="right", angle=73.123456789)
    data["lights"] = [
        {
            "id": "l1",
            "name": "原图灯位",
            "kind": "pendant",
            "x": 3.123456789,
            "y": 2.987654321,
            "elevation": 2.3,
            "lumens": 650,
            "temperature": 2700,
            "enabled": False,
        }
    ]
    return Layout.model_validate_json(Layout.model_validate(data).model_dump_json())


def patch_for(layout, **changes):
    return LayoutReviewPatch.model_validate(
        {
            "base_revision": structure_hash(layout),
            "checks": sorted(CHECKS),
            "summary": "对照原图逐项核对",
            "warnings": [],
            **changes,
        }
    )


def test_compact_transport_preserves_geometry_precision_materials_and_door_direction():
    layout = canonical_layout()
    wire = pack_layout(layout)
    assert len(compact_json(wire)) < len(compact_json(layout.model_dump()))
    assert unpack_layout(wire).model_dump() == layout.model_dump()
    assert structure_hash(unpack_layout(wire)) == structure_hash(layout)
    assert (
        apply_review_patch(layout, patch_for(layout)).model_dump()
        == layout.model_dump()
    )


def test_review_merges_valid_changes_atomically_and_preserves_unmentioned_objects():
    layout = canonical_layout()
    wire = pack_layout(layout)
    replacement = deepcopy(wire["rooms"][0])
    replacement["name"] = "原图开放客餐厅"
    openings = deepcopy(wire["openings"])
    openings[0]["width"] = 1.1
    patch = patch_for(
        layout,
        rooms=[
            {
                "action": "update",
                "id": replacement["id"],
                "value": replacement,
                "evidence": "原图标注为开放客餐厅",
            }
        ],
        openings=[
            {"wall_id": "w0", "values": openings, "evidence": "门洞尺寸标注为1.1米"}
        ],
    )
    proposed = apply_review_patch(layout, patch)
    assert proposed.rooms[0].name == replacement["name"]
    assert proposed.openings[0].width == 1.1
    assert proposed.walls == layout.walls and proposed.lights == layout.lights
    assert layout.rooms[0].name != replacement["name"]
    assert layout.openings[0].width == 0.9


@pytest.mark.parametrize(
    "case",
    [
        "revision",
        "incomplete_checks",
        "unknown_id",
        "duplicate_change",
        "orphan_opening",
        "opening_outside",
        "overlapping_wall",
        "no_evidence",
        "empty_rooms",
    ],
)
def test_invalid_review_never_partially_changes_original(case):
    layout = canonical_layout()
    original = deepcopy(layout.model_dump())
    data = patch_for(layout).model_dump()
    wall = pack_layout(layout)["walls"][0]
    if case == "revision":
        data["base_revision"] = "0" * 64
    elif case == "incomplete_checks":
        data["checks"] = ["outline"] * 6
    elif case == "unknown_id":
        data["walls"] = [
            {
                "action": "update",
                "id": "missing",
                "value": {**wall, "id": "missing"},
                "evidence": "原图墙线",
            }
        ]
    elif case == "duplicate_change":
        data["walls"] = [
            {"action": "update", "id": "w0", "value": wall, "evidence": "原图墙线"}
        ] * 2
    elif case == "orphan_opening":
        data["walls"] = [
            {"action": "delete", "id": "w0", "value": None, "evidence": "原图没有此墙"}
        ]
    elif case == "opening_outside":
        data["openings"] = [
            {
                "wall_id": "w0",
                "values": [{**layout.openings[0].model_dump(), "offset": 7.8}],
                "evidence": "原图门洞",
            }
        ]
    elif case == "overlapping_wall":
        data["walls"] = [
            {
                "action": "add",
                "id": "duplicate",
                "value": {**wall, "id": "duplicate"},
                "evidence": "原图墙线",
            }
        ]
    elif case == "no_evidence":
        data["walls"] = [
            {"action": "update", "id": "w0", "value": wall, "evidence": " "}
        ]
    elif case == "empty_rooms":
        data["rooms"] = [
            {"action": "delete", "id": "living", "value": None, "evidence": "原图标注"}
        ]
    with pytest.raises(ValueError):
        apply_review_patch(layout, data)
    assert layout.model_dump() == original


def test_cache_key_includes_every_inference_dependency_and_detects_corruption(tmp_path):
    cache = StageCache(tmp_path)
    dependencies = {
        "source_sha256": "a",
        "instructions": "skill-v1",
        "prompt": "input",
        "schema": {},
        "model": "selected",
        "effort": "high",
        "role": "recognition",
        "runtime": "provider-account-cli",
    }
    key = cache.key(**dependencies)
    for name in dependencies:
        changed = {
            **dependencies,
            name: {"version": 2} if name == "schema" else "changed",
        }
        assert cache.key(**changed) != key
    cache.write(key, {"ok": True})
    assert cache.read(key) == {"ok": True}
    data = json.loads(cache.path(key).read_text(encoding="utf-8"))
    data["output"]["ok"] = False
    cache.path(key).write_text(json.dumps(data), encoding="utf-8")
    assert cache.read(key) is None
    assert not list(tmp_path.rglob("*.tmp"))


@pytest.mark.parametrize("enabled,expected_calls", [(True, 2), (False, 4)])
def test_repeated_source_reuses_validated_stages_but_not_human_confirmation(
    tmp_path, enabled, expected_calls
):
    codex = FakeCodex()
    settings = replace(Settings(), data_dir=tmp_path, ai_cache_enabled=enabled)
    with TestClient(
        create_app(settings, client=codex, model_builder=fake_builder)
    ) as client:
        first = pending(client, create_job(client)["id"])
        second = pending(client, create_job(client)["id"])
        assert len(codex.calls) == expected_calls
        assert first["id"] != second["id"]
        metrics = second["result"]["pipeline_metrics"]["stages"]
        assert len(metrics) == 2
        assert all(stage["cache_hit"] is enabled for stage in metrics)
        assert all(stage["status"] == "validated" for stage in metrics)
        assert all(stage["attempts"] == (0 if enabled else 1) for stage in metrics)
        assert second["result"]["revision"] == first["result"]["revision"]
        assert (
            client.get(f"/api/jobs/{second['id']}/artifacts/model.glb").status_code
            == 409
        )
        assert (
            second["result"].get("consistency", {}).get("source_reviewed") is not True
        )


def test_concurrent_identical_requests_share_complete_results(tmp_path):
    codex = FakeCodex(delay=0.05)
    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(
        create_app(settings, client=codex, model_builder=fake_builder)
    ) as client:
        first, second = create_job(client), create_job(client)
        pending(client, first["id"])
        pending(client, second["id"])
        assert len(codex.calls) == 2


@pytest.mark.parametrize("change", ["notes", "model", "reasoning_effort", "source"])
def test_cache_cannot_cross_different_user_inputs(tmp_path, change):
    codex = FakeCodex()
    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(
        create_app(settings, client=codex, model_builder=fake_builder)
    ) as client:
        if change == "reasoning_effort":
            first = client.post(
                "/api/jobs",
                files={"file": ("plan.png", image_bytes(), "image/png")},
                data={"model": "test-chosen", "reasoning_effort": "high"},
            )
            assert first.status_code == 201
            pending(client, first.json()["id"])
            data = {"model": "test-chosen", "reasoning_effort": "low"}
        else:
            pending(client, create_job(client)["id"])
            data = (
                {"notes": "新要求"}
                if change == "notes"
                else {"model": "test-chosen"}
                if change == "model"
                else {}
            )
        source = image_bytes()
        if change == "source":
            from io import BytesIO

            from PIL import Image

            buffer = BytesIO()
            Image.new("RGB", (120, 90), "black").save(buffer, format="PNG")
            source = buffer.getvalue()
        response = client.post(
            "/api/jobs", files={"file": ("plan.png", source, "image/png")}, data=data
        )
        assert response.status_code == 201
        pending(client, response.json()["id"])
        assert len(codex.calls) == 4


def test_source_mutation_during_ai_is_rejected_and_not_cached(tmp_path):
    class MutatingCodex(FakeCodex):
        async def generate(self, **kwargs):
            result = await super().generate(**kwargs)
            kwargs["image"].write_bytes(b"changed-image")
            return result

    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(
        create_app(settings, client=MutatingCodex(), model_builder=fake_builder)
    ) as client:
        job = create_job(client)
        for _ in range(200):
            current = client.get(f"/api/jobs/{job['id']}").json()
            if current["status"] == "failed":
                break
            time.sleep(0.025)
        assert current["status"] == "failed"
        assert "原图发生变化" in current["error"]
        assert not list((tmp_path / "ai-cache").rglob("*.json"))


def test_invalid_cached_geometry_is_revalidated_and_recomputed(tmp_path):
    codex = FakeCodex()
    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(
        create_app(settings, client=codex, model_builder=fake_builder)
    ) as client:
        pending(client, create_job(client)["id"])
        cache = StageCache(tmp_path / "ai-cache")
        for path in cache.root.rglob("*.json"):
            data = json.loads(path.read_text(encoding="utf-8"))
            if (
                "walls" in data["output"]
                and "outline" in data["output"]
                and "base_revision" not in data["output"]
            ):
                bad = data["output"]
                bad["openings"][0]["wall_id"] = "nonexistent"
                cache.write(data["key"], bad)
        second = pending(client, create_job(client)["id"])
        assert len(codex.calls) == 3  # Recognition recomputed, valid review reused.
        assert second["result"]["pipeline_metrics"]["stages"][0]["cache_rejected"]


@pytest.mark.parametrize("failure", ["invalid_patch", "timeout_full_warnings"])
def test_incomplete_review_preserves_valid_candidate_and_all_uncertainties(
    tmp_path, failure
):
    class IncompleteReview(FakeCodex):
        async def generate(self, **kwargs):
            if (
                kwargs["schema"]["title"] == "LayoutReviewPatch"
                and failure == "timeout_full_warnings"
            ):
                self.calls.append(kwargs)
                raise TimeoutError()
            result = json.loads(await super().generate(**kwargs))
            if kwargs["schema"]["title"] == "LayoutReviewPatch":
                result["base_revision"] = "0" * 64
            elif failure == "timeout_full_warnings":
                result["warnings"] = [f"待核对信息 {i}" for i in range(30)]
            return json.dumps(result)

    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(
        create_app(settings, client=IncompleteReview(), model_builder=fake_builder)
    ) as client:
        job = pending(client, create_job(client)["id"])
        assert job["result"]["ai_review"]["status"] == (
            "incomplete" if failure == "invalid_patch" else "timed_out"
        )
        assert (
            client.get(f"/api/jobs/{job['id']}/artifacts/model.glb").status_code == 409
        )
        initial = Layout.model_validate_json(
            (settings.workspace(job["id"]) / "recognition.json").read_text(
                encoding="utf-8"
            )
        )
        assert job["result"]["revision"] == structure_hash(initial)
        if failure == "timeout_full_warnings":
            assert all(w in job["result"]["warnings"] for w in initial.warnings)
            assert len(job["result"]["warnings"]) >= 31
        assert not (settings.workspace(job["id"]) / "review.json").exists()
