import asyncio
import json
import time
from dataclasses import replace
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.schemas import Furnishing, Layout, validate_furnishing
from backend.app.skills import SkillRegistry
from backend.app.store import Store


def layout_data():
    corners = [{"x": 0, "y": 0}, {"x": 8, "y": 0}, {"x": 8, "y": 6}, {"x": 0, "y": 6}]
    return {
        "title": "测试户型",
        "confidence": 0.9,
        "scale_note": "依据标注尺寸",
        "warnings": [],
        "outline": corners,
        "rooms": [
            {"id": "living", "name": "客厅", "kind": "living", "polygon": corners}
        ],
        "walls": [
            {
                "id": f"w{i}",
                "start": a,
                "end": b,
                "thickness": 0.16,
                "height": 2.7,
                "exterior": True,
            }
            for i, (a, b) in enumerate(zip(corners, corners[1:] + corners[:1]))
        ],
        "openings": [
            {
                "wall_id": "w0",
                "kind": "door",
                "offset": 1,
                "width": 0.9,
                "height": 2.1,
                "bottom": 0,
            }
        ],
    }


def furniture_data():
    return {
        "items": [
            {
                "room_id": "living",
                "kind": "sofa",
                "x": 2,
                "y": 2,
                "width": 2,
                "depth": 0.9,
                "height": 0.8,
                "rotation": 0,
            }
        ],
        "notes": [],
    }


def image_bytes():
    out = BytesIO()
    Image.new("RGB", (120, 90), "white").save(out, format="PNG")
    return out.getvalue()


class FakeCodex:
    """仅用于契约测试的确定性替身，生产没有 mock 后端开关。"""

    alive = True

    def __init__(self, *, delay=0, malformed=False):
        self.calls = []
        self.delay = delay
        self.malformed = malformed
        self.cancelled = False

    async def ensure_started(self):
        pass

    async def stop(self):
        pass

    async def list_models(self, refresh=False):
        return {
            "default_model": "test-default",
            "items": [
                {
                    "id": "test-default",
                    "name": "默认测试模型",
                    "supports_image": True,
                    "efforts": ["medium"],
                    "default_effort": "medium",
                },
                {
                    "id": "test-chosen",
                    "name": "所选测试模型",
                    "supports_image": True,
                    "efforts": ["low", "high"],
                    "default_effort": "high",
                },
                {
                    "id": "text-only",
                    "name": "纯文本模型",
                    "supports_image": False,
                    "efforts": [],
                    "default_effort": None,
                },
            ],
        }

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        try:
            await asyncio.sleep(self.delay)
        except asyncio.CancelledError:
            self.cancelled = True
            raise
        await kwargs["on_event"](
            {"type": "thread", "thread_id": f"thread-{len(self.calls)}"}
        )
        if self.malformed:
            return "{broken JSON"
        return json.dumps(
            furniture_data()
            if kwargs["schema"]["title"] == "Furnishing"
            else layout_data()
        )


async def fake_builder(
    settings, workspace, layout, furniture, style, furniture_mode="library"
):
    (workspace / "model.glb").write_bytes(b"glTF-test-fixture")
    (workspace / "model.blend").write_bytes(b"BLENDER-test-fixture")
    (workspace / "layout.json").write_text(
        json.dumps(
            {
                **layout.model_dump(),
                "furniture": furniture.model_dump()["items"],
                "furniture_notes": furniture.notes,
                "style": style,
            }
        )
    )
    return {
        "mode": furniture_mode,
        "matched": len(furniture.items),
        "total": len(furniture.items),
        "version": "test",
        "blender_version": "test",
        "fallback": [],
    }


def app_for(tmp_path, client):
    return create_app(
        replace(Settings(), data_dir=tmp_path),
        client=client,
        model_builder=fake_builder,
    )


def create_job(client, collaboration=True):
    response = client.post(
        "/api/jobs",
        files={"file": ("plan.png", image_bytes(), "image/png")},
        data={"collaboration": str(collaboration).lower()},
    )
    assert response.status_code == 201, response.text
    return response.json()


def wait_job(client, job_id):
    for _ in range(200):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"succeeded", "failed", "cancelled"}:
            return job
        time.sleep(0.025)
    raise AssertionError("测试任务未结束")


@pytest.mark.parametrize("collaboration,expected_calls", [(False, 2), (True, 3)])
def test_end_to_end_graph_skills_and_artifacts(tmp_path, collaboration, expected_calls):
    codex = FakeCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        job = wait_job(client, create_job(client, collaboration)["id"])
        assert job["status"] == "succeeded", job
        assert len(codex.calls) == expected_calls
        assert all(call["model"] == "test-default" for call in codex.calls)
        assert job["result"]["area"] == 48
        assert all("floorplan-contract" in call["instructions"] for call in codex.calls)
        assert (
            "floorplan-review" in "".join(call["instructions"] for call in codex.calls)
        ) == collaboration
        assert client.get(job["result"]["model_url"]).content.startswith(b"glTF")
        assert (
            client.get(
                f"/api/jobs/{job['id']}/artifacts/recognition-skills.md"
            ).status_code
            == 404
        )
        assert client.post(f"/api/jobs/{job['id']}/retry").status_code == 409
        events = client.get(f"/api/jobs/{job['id']}/events").text
        ids = [int(line[4:]) for line in events.splitlines() if line.startswith("id: ")]
        assert ids == sorted(set(ids)) and len(ids) >= 6
        timeline = client.get(f"/api/jobs/{job['id']}/timeline").json()["items"]
        assert [event["id"] for event in timeline] == ids
        resumed = client.get(
            f"/api/jobs/{job['id']}/events", headers={"Last-Event-ID": str(ids[-2])}
        ).text
        assert f"id: {ids[-1]}\n" in resumed and f"id: {ids[-2]}\n" not in resumed
    # 新应用进程仍能读取产物和成功任务。
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        restored = client.get(f"/api/jobs/{job['id']}").json()
        assert restored["status"] == "succeeded"
        assert restored["result"]["model_url"] == job["result"]["model_url"]


def test_invalid_upload_and_untrusted_origin(tmp_path):
    codex = FakeCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        assert (
            client.post(
                "/api/jobs", files={"file": ("bad.png", b"not an image", "image/png")}
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/jobs",
                files={
                    "file": ("huge.png", b"0" * (20 * 1024 * 1024 + 1), "image/png")
                },
            ).status_code
            == 413
        )
        assert (
            client.post(
                "/api/jobs",
                files={"file": ("plan.png", image_bytes(), "image/png")},
                data={"style": "invalid"},
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/jobs",
                headers={"Origin": "https://unrelated.invalid"},
                files={"file": ("plan.png", image_bytes(), "image/png")},
            ).status_code
            == 403
        )
        assert client.get("/api/jobs/../../secret").status_code == 404
        assert client.get("/api/jobs").json()["items"] == []
        assert not codex.calls


@pytest.mark.parametrize("effort,expected", [(None, "high"), ("low", "low")])
def test_selected_model_persists_across_agents_and_retry(tmp_path, effort, expected):
    codex = FakeCodex(malformed=True)
    with TestClient(app_for(tmp_path, codex)) as client:
        assert (
            client.get("/api/models?refresh=true").json()["default_model"]
            == "test-default"
        )
        for model in ["does-not-exist", "text-only"]:
            response = client.post(
                "/api/jobs",
                files={"file": ("plan.png", image_bytes(), "image/png")},
                data={"model": model},
            )
            assert response.status_code == 422
        assert not codex.calls
        response = client.post(
            "/api/jobs",
            files={"file": ("plan.png", image_bytes(), "image/png")},
            data={
                "model": "test-chosen",
                **({"reasoning_effort": effort} if effort else {}),
            },
        )
        assert response.status_code == 201, response.text
        job = wait_job(client, response.json()["id"])
        assert job["status"] == "failed"
        codex.malformed = False
        retried = client.post(f"/api/jobs/{job['id']}/retry").json()
        result = wait_job(client, retried["id"])
        assert result["status"] == "succeeded", result
        assert result["options"]["model"] == result["result"]["model"] == "test-chosen"
        assert (
            result["options"]["reasoning_effort"]
            == result["result"]["reasoning_effort"]
            == expected
        )
        assert all(
            c["model"] == "test-chosen" and c["reasoning_effort"] == expected
            for c in codex.calls
        )
        assert all(a["model"] == "test-chosen" for a in result["result"]["agents"])
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        restored = client.get(f"/api/jobs/{result['id']}").json()
        assert restored["options"]["model"] == "test-chosen"
        assert restored["options"]["reasoning_effort"] == expected


def test_unsupported_effort_does_not_create_job(tmp_path):
    codex = FakeCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        for effort in ["ultra", "unknown"]:
            response = client.post(
                "/api/jobs",
                files={"file": ("plan.png", image_bytes(), "image/png")},
                data={"model": "test-chosen", "reasoning_effort": effort},
            )
            assert response.status_code == 422
            assert "推理强度" in response.json()["detail"]
        assert client.get("/api/jobs").json()["items"] == []
        assert not codex.calls


def test_cancel_interrupts_and_retry_has_new_workspace(tmp_path):
    codex = FakeCodex(delay=30)
    with TestClient(app_for(tmp_path, codex)) as client:
        job = create_job(client)
        for _ in range(80):
            if codex.calls:
                break
            time.sleep(0.025)
        cancelled = client.post(f"/api/jobs/{job['id']}/cancel").json()
        assert cancelled["status"] == "cancelled" and codex.cancelled
        assert (
            client.get(f"/api/jobs/{job['id']}/artifacts/model.glb").status_code == 409
        )
        codex.delay = 0
        retried = client.post(f"/api/jobs/{job['id']}/retry").json()
        assert retried["id"] != job["id"]
        assert wait_job(client, retried["id"])["status"] == "succeeded"
        assert client.get(f"/api/jobs/{job['id']}").json()["status"] == "cancelled"


def test_malformed_model_response_never_becomes_success(tmp_path):
    codex = FakeCodex(malformed=True)
    with TestClient(app_for(tmp_path, codex)) as client:
        job = wait_job(client, create_job(client)["id"])
        assert job["status"] == "failed" and job["result"] is None
        assert len(codex.calls) == 2  # 最多进行一次结构修正。
        assert not (tmp_path / "jobs" / job["id"] / "model.glb").exists()


def test_geometry_rejects_invalid_references_and_outside_furniture():
    data = layout_data()
    data["openings"][0]["offset"] = 7.5
    with pytest.raises(ValidationError):
        Layout.model_validate(data)
    data = layout_data()
    data["walls"][1]["id"] = "w0"
    with pytest.raises(ValidationError):
        Layout.model_validate(data)
    plan = furniture_data()
    plan["items"][0]["x"] = 0.1
    with pytest.raises(ValueError, match="边界"):
        validate_furnishing(
            Furnishing.model_validate(plan), Layout.model_validate(layout_data())
        )
    data = layout_data()
    data["outline"] = [
        {"x": 0, "y": 0},
        {"x": 8, "y": 6},
        {"x": 8, "y": 0},
        {"x": 0, "y": 6},
    ]
    with pytest.raises(ValidationError, match="自交"):
        Layout.model_validate(data)


@pytest.mark.asyncio
async def test_terminal_state_is_monotonic_and_recovery(tmp_path):
    store = Store(tmp_path / "jobs.sqlite3")
    await store.initialize()
    await store.create("one", "a.png", {})
    await store.update("one", status="cancelled")
    assert not await store.update(
        "one", status="succeeded", result={"model_url": "bad"}
    )
    assert (await store.get("one"))["status"] == "cancelled"
    await store.create("two", "b.png", {})
    await store.update("two", status="running")
    await store.recover()
    assert (await store.get("two"))["status"] == "failed"
    assert (await store.get("two"))["error"]


def test_skill_registry_rejects_path_escape():
    registry = SkillRegistry(Settings().skills_dir)
    with pytest.raises(ValueError):
        registry.compose("../../.codex/config")
    text, manifest = registry.compose(
        "floorplan-contract", "floorplan-contract", "floorplan-review"
    )
    assert len(manifest) == 2 and text.count("<project-skill") == 2


def test_rebuild_reuses_geometry_without_codex_and_retry_retains_seed(tmp_path):
    codex = FakeCodex()
    failure = {"enabled": False}

    async def builder(*args, **kwargs):
        if failure["enabled"]:
            raise RuntimeError("测试建模失败")
        return await fake_builder(*args, **kwargs)

    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(
        create_app(settings, client=codex, model_builder=builder)
    ) as client:
        source = wait_job(client, create_job(client)["id"])
        count = len(codex.calls)
        failure["enabled"] = True
        response = client.post(f"/api/jobs/{source['id']}/rebuild")
        assert response.status_code == 201, response.text
        rebuild = wait_job(client, response.json()["id"])
        assert rebuild["status"] == "failed" and rebuild["rebuild_of"] == source["id"]
        failure["enabled"] = False
        codex.malformed = True  # 重建/重试都不应再次调用识别模型。
        retried = client.post(f"/api/jobs/{rebuild['id']}/retry")
        assert retried.status_code == 201, retried.text
        result = wait_job(client, retried.json()["id"])
        assert result["status"] == "succeeded", result
        assert result["result"]["furniture"]["mode"] == "library"
        assert result["result"]["rebuild_of"] == source["id"]
        assert len(codex.calls) == count
        assert client.get(f"/api/jobs/{source['id']}").json()["status"] == "succeeded"
        assert (
            client.get(
                f"/api/jobs/{result['id']}/artifacts/rebuild-seed.json"
            ).status_code
            == 404
        )
        assert client.get("/api/furniture").json()["items"]
        (settings.workspace(source["id"]) / "layout.json").write_text("{}")
        assert client.post(f"/api/jobs/{source['id']}/rebuild").status_code == 409


def test_basic_mode_remains_available(tmp_path):
    codex = FakeCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        response = client.post(
            "/api/jobs",
            files={"file": ("plan.png", image_bytes(), "image/png")},
            data={"furniture_mode": "basic"},
        )
        job = wait_job(client, response.json()["id"])
        assert job["status"] == "succeeded", job
        assert job["result"]["furniture"]["mode"] == "basic"
        invalid = client.post(
            "/api/jobs",
            files={"file": ("plan.png", image_bytes(), "image/png")},
            data={"furniture_mode": "untrusted-path"},
        )
        assert invalid.status_code == 422


def test_manual_edit_isolated_materials_passage_and_retry_without_codex(tmp_path):
    codex = FakeCodex()
    failure = {"enabled": False}

    async def builder(*args, **kwargs):
        if failure["enabled"]:
            raise RuntimeError("模拟建模失败")
        return await fake_builder(*args, **kwargs)

    settings = replace(Settings(), data_dir=tmp_path)
    with TestClient(
        create_app(settings, client=codex, model_builder=builder)
    ) as client:
        source = wait_job(client, create_job(client)["id"])
        original = client.get(f"/api/jobs/{source['id']}/artifacts/layout.json").content
        count = len(codex.calls)
        payload = {
            "name": "人工微调版本",
            "layout": layout_data(),
            "furniture": furniture_data(),
        }
        payload["layout"]["rooms"][0]["floor_finish"] = "walnut"
        payload["layout"]["walls"][0]["finish"] = "sage"
        payload["layout"]["openings"][0]["kind"] = "passage"
        payload["furniture"]["items"][0]["x"] = 3
        failure["enabled"] = True
        response = client.post(f"/api/jobs/{source['id']}/edit", json=payload)
        assert response.status_code == 201, response.text
        edited = wait_job(client, response.json()["id"])
        assert edited["status"] == "failed" and edited["edited_of"] == source["id"]
        assert (
            client.post(f"/api/jobs/{edited['id']}/edit", json=payload).status_code
            == 409
        )
        failure["enabled"] = False
        retried = client.post(f"/api/jobs/{edited['id']}/retry")
        result = wait_job(client, retried.json()["id"])
        assert result["status"] == "succeeded", result
        assert result["result"]["edited_of"] == source["id"]
        data = client.get(f"/api/jobs/{result['id']}/artifacts/layout.json").json()
        assert data["rooms"][0]["floor_finish"] == "walnut"
        assert data["walls"][0]["finish"] == "sage"
        assert data["openings"][0]["kind"] == "passage"
        assert data["furniture"][0]["x"] == 3
        assert len(codex.calls) == count
        assert (
            client.get(f"/api/jobs/{source['id']}/artifacts/layout.json").content
            == original
        )
        assert result["id"] != source["id"]


@pytest.mark.parametrize("invalid", ["furniture", "overlap", "floor", "passage"])
def test_manual_edit_rejects_invalid_geometry_without_creating_task(tmp_path, invalid):
    codex = FakeCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        source = wait_job(client, create_job(client)["id"])
        payload = {
            "name": "微调",
            "layout": layout_data(),
            "furniture": furniture_data(),
        }
        if invalid == "furniture":
            payload["furniture"]["items"][0]["x"] = 0
        elif invalid == "overlap":
            payload["layout"]["openings"].append(dict(payload["layout"]["openings"][0]))
        elif invalid == "floor":
            points = payload["layout"]["rooms"][0]["polygon"]
            points[1], points[2] = points[2], points[1]
        else:
            payload["layout"]["openings"][0].update(kind="passage", bottom=0.1)
        response = client.post(f"/api/jobs/{source['id']}/edit", json=payload)
        assert response.status_code == 422, response.text
        assert len(client.get("/api/jobs").json()["items"]) == 1


def test_parallel_tasks_keep_inputs_options_events_and_cancellation_isolated(tmp_path):
    class IsolatedCodex(FakeCodex):
        async def generate(self, **kwargs):
            if "等待中的方案A" in kwargs["prompt"]:
                self.calls.append(kwargs)
                await asyncio.sleep(30)
            return await super().generate(**kwargs)

    codex = IsolatedCodex()
    settings = replace(Settings(), data_dir=tmp_path, concurrency=2)
    with TestClient(
        create_app(settings, client=codex, model_builder=fake_builder)
    ) as client:
        first = client.post(
            "/api/jobs",
            files={"file": ("a.png", image_bytes(), "image/png")},
            data={
                "name": "  公寓方案 A  ",
                "notes": "等待中的方案A",
                "model": "test-chosen",
                "reasoning_effort": "low",
            },
        )
        assert first.status_code == 201, first.text
        a = first.json()
        red_image = BytesIO()
        Image.new("RGB", (100, 100), "red").save(red_image, format="PNG")
        second = client.post(
            "/api/jobs",
            files={"file": ("b.png", red_image.getvalue(), "image/png")},
            data={
                "name": "公寓方案 B",
                "notes": "独立方案B",
                "model": "test-default",
                "reasoning_effort": "medium",
            },
        )
        assert second.status_code == 201, second.text
        b = wait_job(client, second.json()["id"])
        assert b["status"] == "succeeded", b
        assert client.get(f"/api/jobs/{a['id']}").json()["status"] == "running"
        assert a["name"] == "公寓方案 A" and b["name"] == "公寓方案 B"
        assert a["options"]["reasoning_effort"] == "low"
        assert b["result"]["reasoning_effort"] == "medium"
        assert (
            client.get(a["source_url"]).content != client.get(b["source_url"]).content
        )
        assert a["id"] != b["id"] and b["id"] in b["result"]["model_url"]
        for task in [a, b]:
            events = client.get(f"/api/jobs/{task['id']}/timeline").json()["items"]
            assert events and all(e["job_id"] == task["id"] for e in events)
            calls = [c for c in codex.calls if c["workspace"].name == task["id"]]
            assert calls and all(c["model"] == task["options"]["model"] for c in calls)
            assert all(
                c["image"] == settings.workspace(task["id"]) / "source.png"
                for c in calls
            )
        assert (
            client.post(f"/api/jobs/{a['id']}/cancel").json()["status"] == "cancelled"
        )
        assert client.get(f"/api/jobs/{b['id']}").json()["result"] == b["result"]
        assert client.get(b["result"]["model_url"]).status_code == 200
        assert client.get(f"/api/jobs/{a['id']}/artifacts/model.glb").status_code == 409


@pytest.mark.asyncio
async def test_task_list_keeps_older_generations_visible(tmp_path):
    store = Store(tmp_path / "jobs.sqlite3")
    await store.initialize()
    for index in range(32):
        await store.create(str(index), f"方案 {index}", {})
    assert len(await store.list()) == 32
    assert len(await store.list(limit=5)) == 5
