import asyncio
import json
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import codex_runtime
from backend.app.ai_providers import AIClientRouter
from backend.app.codex import CodexClient, CodexError
from backend.app.codex_runtime import CodexRuntime, cli_version, newer_version
from backend.app.config import Settings, find_codex_command
from backend.app.main import create_app
from backend.tests.test_workflow import FakeCodex, fake_builder


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    local = FakeCodex()
    local.auth_status = "configured"
    monkeypatch.setattr(codex_runtime, "cli_version", AsyncMock(return_value="0.130.0"))
    return CodexRuntime(replace(Settings(), data_dir=tmp_path), local)


@pytest.mark.asyncio
async def test_diagnostics_records_only_platform_version_and_never_calls_inference(
    runtime,
):
    runtime.local.generate = AsyncMock(side_effect=AssertionError("no inference"))
    result = await runtime.inspect()
    assert result["diagnostics"]["status"] == "ready"
    assert result["diagnostics"]["auth_status"] == "configured"
    assert result["catalog"]["items"]
    saved = json.loads(runtime.history_path.read_text())
    assert set(saved) == {"version", "checked_at", "platform", "architecture"}
    assert saved["version"] == "0.130.0"
    assert CodexRuntime(runtime.settings, runtime.local).history == saved
    runtime.local.alive = False
    assert runtime.snapshot()["status"] == "disconnected"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error,code,action",
    [
        (FileNotFoundError("private-path"), "not_installed", "install"),
        (CodexError("未登录 private-token"), "authentication", "login"),
        (CodexError("method not found private-token"), "incompatible", "upgrade"),
        (TimeoutError("private-token"), "timeout", "retry"),
        (PermissionError("private-token"), "permission", "configure"),
    ],
)
async def test_failures_are_actionable_redacted_and_preserve_last_verified(
    runtime, monkeypatch, error, code, action
):
    await runtime.inspect()
    old = runtime.history_path.read_bytes()
    monkeypatch.setattr(codex_runtime, "cli_version", AsyncMock(side_effect=error))
    result = await runtime.inspect()
    assert result["diagnostics"]["status"] == "error"
    assert result["diagnostics"]["code"] == code
    assert result["diagnostics"]["action"] == action
    assert result["catalog"] is None
    assert "private-" not in json.dumps(result)
    assert runtime.history_path.read_bytes() == old


@pytest.mark.asyncio
async def test_catalog_retries_once_only_for_transient_failures(runtime):
    catalog = await runtime.local.list_models()
    runtime.local.list_models = AsyncMock(
        side_effect=[CodexError("Codex 连接中断"), catalog]
    )
    result = await runtime.inspect()
    assert result["diagnostics"]["retry_count"] == 1
    assert result["diagnostics"]["status"] == "ready"
    assert runtime.local.list_models.await_count == 2
    runtime.local.list_models = AsyncMock(side_effect=CodexError("Codex 连接中断"))
    assert (await runtime.inspect())["diagnostics"]["status"] == "error"
    assert runtime.local.list_models.await_count == 2
    runtime.local.list_models = AsyncMock(side_effect=CodexError("未登录"))
    await runtime.inspect()
    assert runtime.local.list_models.await_count == 1


@pytest.mark.asyncio
async def test_upgrade_requires_reconnect_before_claiming_new_version_compatible(
    runtime, monkeypatch
):
    runtime.local.launch_signature = ["old", 1, 1]
    monkeypatch.setattr(
        codex_runtime, "codex_command_signature", lambda _: ["new", 2, 1]
    )
    runtime.local.list_models = AsyncMock()
    result = await runtime.inspect()
    assert result["diagnostics"]["status"] == "restart_required"
    assert result["catalog"] is None
    runtime.local.list_models.assert_not_called()
    assert not runtime.history_path.exists()


@pytest.mark.asyncio
async def test_safe_reconnect_refuses_busy_client_and_counts_entire_generation(
    tmp_path,
):
    local = CodexClient(replace(Settings(), data_dir=tmp_path))
    local.stop = AsyncMock()
    local.ensure_started = AsyncMock()
    started = asyncio.Event()

    async def generating(**kwargs):
        started.set()
        await asyncio.Event().wait()

    local._generate = generating
    task = asyncio.create_task(local.generate())
    await started.wait()
    assert local.active_generations == 1
    with pytest.raises(CodexError, match="正在处理任务"):
        await local.reconnect()
    local.stop.assert_not_called()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert local.active_generations == 0
    await local.reconnect()
    local.stop.assert_awaited_once()
    local.ensure_started.assert_awaited_once()


@pytest.mark.asyncio
async def test_unlogged_cli_is_not_reported_ready_and_does_not_read_catalog():
    local = CodexClient(Settings())
    local.ensure_started = AsyncMock()

    async def request(method, params):
        if method == "config/read":
            return {"config": {}}
        if method == "account/read":
            return {"account": None, "requiresOpenaiAuth": True}
        raise AssertionError("must not read models for an unauthenticated connection")

    local.request = request
    with pytest.raises(CodexError, match="尚未登录"):
        await local.list_models()
    assert local.auth_status == "required"


@pytest.mark.asyncio
async def test_update_lookup_is_fixed_bounded_cached_and_sends_no_credentials(runtime):
    calls = []

    async def handler(request):
        calls.append(request)
        assert str(request.url) == codex_runtime.RELEASE_URL
        assert "authorization" not in request.headers
        assert "cookie" not in request.headers
        return httpx.Response(200, json={"name": "@openai/codex", "version": "0.131.0"})

    runtime.transport = httpx.MockTransport(handler)
    await runtime.inspect()
    result = await runtime.check_update()
    assert result["update"]["available"] is True
    assert result["status"] == "ready"
    await runtime.check_update()
    assert len(calls) == 1
    runtime.report["version"] = "0.131.0"
    assert runtime.snapshot()["update"]["available"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, text="private-token"),
        httpx.Response(302, headers={"location": "https://untrusted.invalid"}),
        httpx.Response(200, json={"name": "wrong", "version": "0.131.0"}),
        httpx.Response(200, content=b"x" * (256 * 1024 + 1)),
    ],
)
async def test_update_failures_do_not_break_existing_connection(runtime, response):
    runtime.transport = httpx.MockTransport(lambda _: response)
    await runtime.inspect()
    result = await runtime.check_update()
    assert result["update"]["status"] == "unavailable"
    assert result["status"] == "ready"
    assert "private-token" not in json.dumps(result)


@pytest.mark.parametrize(
    "latest,current,result",
    [
        ("0.131.0", "0.99.0", True),
        ("0.130.0", "0.130.0", False),
        ("0.130.0", "0.130.0-beta.2", True),
        ("0.130.0", "0.131.0", False),
        ("0.131.0-beta", "0.130.0", None),
        ("0.131.0", None, None),
    ],
)
def test_semver_comparison(latest, current, result):
    assert newer_version(latest, current) is result


def test_runtime_endpoints_do_not_change_default_or_credentials(tmp_path, monkeypatch):
    monkeypatch.setattr(codex_runtime, "cli_version", AsyncMock(return_value="0.130.0"))
    app = create_app(
        replace(Settings(), data_dir=tmp_path),
        client=FakeCodex(),
        model_builder=fake_builder,
    )
    with TestClient(app) as client:
        before = client.get("/api/ai/settings").json()
        assert (
            client.post(
                "/api/ai/codex/check", headers={"origin": "https://untrusted.invalid"}
            ).status_code
            == 403
        )
        response = client.post("/api/ai/codex/check")
        assert response.json()["diagnostics"]["status"] == "ready"
        after = client.get("/api/ai/settings").json()
        assert after["revision"] == before["revision"]
        assert after["default_provider"] == before["default_provider"]
        assert after["deepseek"] == before["deepseek"]
        assert not (tmp_path / "ai/connections.json").exists()


@pytest.mark.asyncio
async def test_catalog_router_retries_without_switching_provider(tmp_path):
    local = FakeCodex()
    catalog = await local.list_models()
    local.list_models = AsyncMock(side_effect=[CodexError("Codex 连接中断"), catalog])
    router = AIClientRouter(replace(Settings(), data_dir=tmp_path), local)
    router.remote.list_models = AsyncMock(side_effect=AssertionError("no fallback"))
    assert (await router.list_models(provider="codex"))["provider"] == "codex"
    assert local.list_models.await_count == 2
    router.remote.list_models.assert_not_called()


@pytest.mark.asyncio
async def test_version_probe_cancellation_kills_and_reaps_process(monkeypatch):
    process = SimpleNamespace(
        returncode=None,
        stdout=SimpleNamespace(read=AsyncMock(side_effect=asyncio.CancelledError())),
    )
    process.kill = lambda: setattr(process, "returncode", -1)
    process.wait = AsyncMock()
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", AsyncMock(return_value=process)
    )
    with pytest.raises(asyncio.CancelledError):
        await cli_version("codex")
    assert process.returncode == -1
    process.wait.assert_awaited_once()


@pytest.mark.asyncio
async def test_cancelled_initialization_closes_owned_app_server(monkeypatch):
    local = CodexClient(Settings())
    process = SimpleNamespace(returncode=None, stdin=SimpleNamespace(close=Mock()))

    async def exited():
        process.returncode = 0

    process.wait = exited
    local._read = AsyncMock()
    local._stderr = AsyncMock()
    local.request = AsyncMock(side_effect=asyncio.CancelledError())
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", AsyncMock(return_value=process)
    )
    with pytest.raises(asyncio.CancelledError):
        await local.ensure_started()
    process.stdin.close.assert_called_once()
    assert not local.alive
    assert not local.tasks


@pytest.mark.asyncio
async def test_rejected_startup_flags_are_reported_as_incompatible(runtime):
    runtime.local.alive = False
    runtime.local.stderr = ["unexpected argument --removed-option private-token"]
    runtime.local.list_models = AsyncMock(side_effect=CodexError("本地 Codex 连接中断"))
    result = await runtime.inspect()
    assert result["diagnostics"]["code"] == "incompatible"
    assert "private-token" not in json.dumps(result)


def test_cli_discovery_honors_override_and_common_mac_path(monkeypatch):
    monkeypatch.setenv("CODEX_CMD", "/custom/codex")
    assert find_codex_command() == "/custom/codex"
    monkeypatch.delenv("CODEX_CMD")
    monkeypatch.setattr("backend.app.config.shutil.which", lambda _: None)
    # Use portable path separators when this test itself runs on Windows.
    monkeypatch.setattr(
        "backend.app.config.Path.is_file",
        lambda p: p.as_posix().endswith("/opt/homebrew/bin/codex"),
    )
    assert find_codex_command().replace("\\", "/").endswith("/opt/homebrew/bin/codex")
