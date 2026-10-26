"""Provider routing, key custody, capability checks and real workflow contracts."""

import asyncio
import json
import time
from dataclasses import replace

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.ai_credentials import ConnectionStore
from backend.app.ai_providers import DEEPSEEK_PREFIX, AIClientRouter
from backend.app.codex import CodexError
from backend.app.config import Settings
from backend.app.main import create_app
from backend.tests.test_diy import design_data
from backend.tests.test_workflow import FakeCodex, fake_builder, image_bytes, wait_job

KEY = "unit-test-private-connection-marker"
VISION = DEEPSEEK_PREFIX + "vision"
TEXT = DEEPSEEK_PREFIX + "text-only"


def models():
    return {
        "data": [
            {
                "id": "vision",
                "name": "DeepSeek Vision",
                "input_modalities": ["text", "image"],
                "effort": {
                    "supported_levels": ["low", "high", "max"],
                    "default_level": "high",
                },
            },
            {"id": "text-only", "input_modalities": ["text"]},
        ]
    }


def connection_app(tmp_path):
    local = FakeCodex()
    app = create_app(
        replace(Settings(), data_dir=tmp_path), client=local, model_builder=fake_builder
    )
    calls = []
    designer = FakeCodex()

    async def ignore(_):
        pass

    async def handler(request):
        calls.append(request)
        if request.headers.get("authorization") != "Bearer " + KEY:
            # The upstream may echo credentials. The adapter must never echo its body.
            return httpx.Response(401, json={"error": "密钥错误 " + KEY})
        if request.url.path == "/models":
            return httpx.Response(200, json=models())
        body = json.loads(request.content)
        schema = json.loads(body["messages"][0]["content"].split("JSON Schema:\n")[1])
        content = body["messages"][1]["content"]
        prompt = content[0]["text"] if isinstance(content, list) else content
        if schema.get("title") == "DiyDesign":
            result = json.dumps(design_data())
        elif schema.get("title") == "MaterialParameters":
            result = json.dumps(
                {
                    "name": "暖白哑光墙面",
                    "kind": "乳胶漆",
                    "preset": "paint",
                    "color": "#e8e3d7",
                    "accent": "#ddd7c8",
                    "roughness": 0.8,
                    "intensity": 0.25,
                    "density": 2,
                    "layout": "straight",
                    "joint": 0.01,
                    "note": "测试材质",
                }
            )
        else:
            result = await designer.generate(
                schema=schema, prompt=prompt, on_event=ignore
            )
        return httpx.Response(
            200,
            json={
                "choices": [{"finish_reason": "stop", "message": {"content": result}}]
            },
        )

    app.state.ai_client.remote.transport = httpx.MockTransport(handler)
    return app, local, calls


def enable(client, model=VISION, revision=0, key=KEY):
    response = client.post(
        "/api/ai/settings",
        json={
            "provider": "deepseek",
            "revision": revision,
            "model": model,
            "api_key": key,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_credentials_are_encrypted_and_preview_never_persists(tmp_path):
    app, _, calls = connection_app(tmp_path)
    with TestClient(app) as client:
        result = client.post(
            "/api/ai/test", json={"provider": "deepseek", "api_key": KEY}
        )
        assert result.status_code == 200
        assert KEY not in result.text
        assert not (tmp_path / "ai" / "connections.json").exists()
        settings = enable(client)
        assert settings["default_provider"] == "deepseek"
        assert settings["deepseek"]["configured"] is True
        assert KEY not in json.dumps(settings)
        assert "secret" not in settings
        assert KEY not in (tmp_path / "ai" / "connections.json").read_text()
        assert ConnectionStore(tmp_path).secret() == KEY
        assert client.get("/api/models").json()["provider"] == "deepseek"
        assert client.get("/api/models?provider=codex").json()["provider"] == "codex"
        assert calls


def test_failed_change_is_atomic_and_errors_are_redacted(tmp_path):
    app, _, _ = connection_app(tmp_path)
    with TestClient(app) as client:
        enable(client)
        old_file = (tmp_path / "ai" / "connections.json").read_bytes()
        invalid = client.post(
            "/api/ai/settings",
            json={
                "provider": "deepseek",
                "revision": 1,
                "model": VISION,
                "api_key": "invalid-test-value",
            },
        )
        assert invalid.status_code == 503
        assert KEY not in invalid.text and "invalid-test-value" not in invalid.text
        assert "密钥无效" in invalid.text
        assert (tmp_path / "ai" / "connections.json").read_bytes() == old_file
        stale = client.post(
            "/api/ai/settings", json={"provider": "codex", "revision": 0}
        )
        assert stale.status_code == 409
        cross_origin = client.post(
            "/api/ai/test",
            json={"provider": "deepseek", "api_key": KEY},
            headers={"origin": "https://unrelated.invalid"},
        )
        assert cross_origin.status_code == 403


def test_key_retention_removal_and_restart(tmp_path):
    app, _, _ = connection_app(tmp_path)
    with TestClient(app) as client:
        enable(client)
        # A blank field never erases a saved credential.
        kept = client.post(
            "/api/ai/settings",
            json={"provider": "deepseek", "revision": 1, "model": TEXT, "api_key": ""},
        )
        assert kept.status_code == 200
        assert ConnectionStore(tmp_path).secret() == KEY
        assert ConnectionStore(tmp_path).data["deepseek_model"] == "text-only"
        removed = client.post(
            "/api/ai/settings",
            json={"provider": "codex", "revision": 2, "remove_key": True},
        )
        assert removed.status_code == 200
        assert removed.json()["default_provider"] == "codex"
        assert not removed.json()["deepseek"]["configured"]
        assert ConnectionStore(tmp_path).secret() is None
        assert client.get("/api/models?provider=deepseek").status_code == 503


def test_saved_model_is_authoritative_and_key_errors_never_echo_input(tmp_path):
    app, _, _ = connection_app(tmp_path)
    with TestClient(app) as client:
        enable(client, TEXT)
        catalog = client.get("/api/models?provider=deepseek").json()
        assert catalog["configured_default"] is True
        assert catalog["default_model"] == TEXT
        for key in ("bad key with spaces", "密钥不应出现在响应里面"):
            response = client.post(
                "/api/ai/test", json={"provider": "deepseek", "api_key": key}
            )
            assert response.status_code == 422
            assert key not in response.text
        response = client.post(
            "/api/ai/test", json={"provider": "codex", "api_key": KEY}
        )
        assert response.status_code == 422
        assert KEY not in response.text


def test_portable_vault_and_corrupt_record_recovery(tmp_path):
    store = ConnectionStore(tmp_path)
    store.data["secret"] = "fernet:" + store._fernet().encrypt(KEY.encode()).decode()
    assert store.secret() == KEY
    store.path.write_text(
        '{"default_provider":"deepseek","revision":"invalid"}', encoding="utf-8"
    )
    recovered = ConnectionStore(tmp_path)
    assert recovered.error
    assert recovered.data["default_provider"] == "codex"
    assert recovered.data["revision"] == 0


def test_text_model_rejected_before_image_task_is_created(tmp_path):
    app, local, calls = connection_app(tmp_path)
    with TestClient(app) as client:
        enable(client, TEXT)
        rejected = client.post(
            "/api/jobs",
            files={"file": ("plan.png", image_bytes(), "image/png")},
            data={"model": TEXT},
        )
        assert rejected.status_code == 422
        assert "不支持图片" in rejected.text
        assert not any(r.url.path == "/chat/completions" for r in calls)
        assert not local.calls
        assert not client.get("/api/jobs").json()["items"]


def test_deepseek_runs_recognition_review_and_furnishing_without_local_cli(tmp_path):
    app, local, calls = connection_app(tmp_path)
    with TestClient(app) as client:
        enable(client)
        created = client.post(
            "/api/jobs",
            files={"file": ("plan.png", image_bytes(), "image/png")},
            data={"model": VISION, "reasoning_effort": "high", "collaboration": "true"},
        )
        assert created.status_code == 201, created.text
        # Changing the default does not reroute an already-created job.
        switched = client.post(
            "/api/ai/settings", json={"provider": "codex", "revision": 1}
        )
        assert switched.status_code == 200
        job = wait_job(client, created.json()["id"])
        assert job["status"] == "succeeded", job
        assert not local.calls
        wire = [
            json.loads(r.content) for r in calls if r.url.path == "/chat/completions"
        ]
        assert len(wire) == 3
        assert all(
            body["model"] == "vision" and body["reasoning_effort"] == "high"
            for body in wire
        )
        assert wire[0]["messages"][1]["content"][1]["image_url"]["url"].startswith(
            "data:image/png;base64,"
        )
        assert KEY not in (tmp_path / "studio.sqlite3").read_bytes().decode(
            "utf-8", errors="ignore"
        )


def test_diy_and_material_generation_use_saved_default_and_persist_provider(tmp_path):
    app, local, _calls = connection_app(tmp_path)
    with TestClient(app) as client:
        enable(client, TEXT)
        diy = client.post("/api/diy/generate", json={"prompt": "做一个原木小边桌"})
        assert diy.status_code == 202, diy.text
        for _ in range(160):
            asset = client.get(f"/api/diy/assets/{diy.json()['id']}").json()
            if asset["status"] not in {"queued", "running"}:
                break
            time.sleep(0.025)
        assert asset["status"] == "ready", asset
        assert asset["request"]["model"] == TEXT
        material = client.post(
            "/api/materials/generations",
            json={"category": "walls", "prompt": "暖白色哑光墙面"},
        )
        assert material.status_code == 202, material.text
        for _ in range(160):
            entries = client.get("/api/materials/generations?category=walls").json()[
                "items"
            ]
            record = next(i for i in entries if i["id"] == material.json()["id"])
            if record["status"] not in {"queued", "running"}:
                break
            time.sleep(0.025)
        assert record["status"] == "succeeded", record
        assert json.loads(record["request"])["model"] == TEXT
        assert not local.calls


@pytest.mark.asyncio
async def test_unprefixed_models_stay_local_and_transient_failure_never_falls_back(
    tmp_path,
):
    local = FakeCodex()
    router = AIClientRouter(replace(Settings(), data_dir=tmp_path), local)
    router.connections.save(provider="deepseek", model="vision", secret=KEY)

    async def failed(_):
        return httpx.Response(429, json={"error": KEY})

    router.remote.transport = httpx.MockTransport(failed)
    with pytest.raises(CodexError, match="过于频繁"):
        await router.generate(
            workspace=tmp_path,
            image=None,
            prompt="test",
            instructions="test",
            schema={},
            model=VISION,
        )
    assert not local.calls

    async def event(_):
        pass

    await router.generate(
        workspace=tmp_path,
        image=None,
        prompt="test",
        instructions="test",
        schema={"title": "Furnishing"},
        model="test-default",
        on_event=event,
    )
    assert local.calls[0]["model"] == "test-default"


@pytest.mark.asyncio
async def test_truncated_response_rejected_and_cancellation_propagates(tmp_path):
    router = AIClientRouter(replace(Settings(), data_dir=tmp_path), FakeCodex())
    router.connections.save(provider="deepseek", secret=KEY)
    entered = asyncio.Event()

    async def handler(request):
        if request.url.path == "/models":
            return httpx.Response(200, json=models())
        entered.set()
        await asyncio.sleep(30)

    router.remote.transport = httpx.MockTransport(handler)
    task = asyncio.create_task(
        router.generate(
            workspace=tmp_path,
            image=None,
            prompt="test",
            instructions="test",
            schema={},
            model=VISION,
        )
    )
    await asyncio.wait_for(entered.wait(), 2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    async def truncated(request):
        if request.url.path == "/models":
            return httpx.Response(200, json=models())
        return httpx.Response(
            200,
            json={
                "choices": [{"finish_reason": "length", "message": {"content": "{}"}}]
            },
        )

    router.remote.transport = httpx.MockTransport(truncated)
    with pytest.raises(CodexError, match="未完整结束"):
        await router.generate(
            workspace=tmp_path,
            image=None,
            prompt="test",
            instructions="test",
            schema={},
            model=VISION,
        )
