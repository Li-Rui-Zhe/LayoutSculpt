import asyncio
import json
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.app.codex import CodexClient, CodexError
from backend.app.codex_environment import child_environment, environment_mode, isolated_args
from backend.app.codex_login import CodexLogin
from backend.app.config import Settings
from backend.app.ai_credentials import atomic_private_write
from backend.tests.test_ai_connections import connection_app, KEY


def test_one_click_connect_selects_model_and_saves_only_after_validation(tmp_path):
    app, _, calls = connection_app(tmp_path)
    with TestClient(app) as client:
        wrong = client.post("/api/ai/settings", json={"provider":"deepseek", "revision":0, "api_key":"invalid-key", "model":None})
        assert wrong.status_code == 503
        assert client.get("/api/ai/settings").json()["revision"] == 0
        result = client.post("/api/ai/settings", json={"provider":"deepseek", "revision":0, "api_key":KEY, "model":None})
        assert result.status_code == 200, result.text
        value = result.json()
        assert value["deepseek"]["configured"]
        assert value["catalog"]["default_model"]
        assert value["default_provider"] == "deepseek"
        assert KEY not in result.text
        assert all(request.url.path == "/models" for request in calls)
        old = client.post("/api/ai/settings", json={"provider":"codex", "revision":0})
        assert old.status_code == 409
        assert client.get("/api/ai/settings").json()["default_provider"] == "deepseek"


def test_isolated_environment_does_not_inherit_credentials_or_change_parent(tmp_path, monkeypatch):
    from backend.app import codex_environment as module
    monkeypatch.setattr(module, "private_directory", lambda folder: folder.mkdir(parents=True, exist_ok=True))
    settings = replace(Settings(), data_dir=tmp_path)
    monkeypatch.setenv("CODEX_HOME", "outside-home")
    monkeypatch.setenv("OPENAI_API_KEY", "outside-secret")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://other.invalid")
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid:3128")
    isolated = child_environment(settings, "isolated")
    shared = child_environment(settings, "shared")
    assert isolated["CODEX_HOME"] == str(tmp_path / "runtime/codex-home")
    assert "OPENAI_API_KEY" not in isolated and "OPENAI_BASE_URL" not in isolated
    assert isolated["HTTPS_PROXY"] == shared["HTTPS_PROXY"]
    assert shared["CODEX_HOME"] == "outside-home"
    assert shared["OPENAI_API_KEY"] == "outside-secret"
    assert 'cli_auth_credentials_store="file"' in isolated_args("isolated")
    assert isolated_args("shared") == []
    assert environment_mode(settings) == "shared"
    atomic_private_write(tmp_path / "runtime/active.json", json.dumps({"codex":{"path":"missing.exe","config_mode":"isolated"}}).encode())
    assert environment_mode(settings) == "isolated"


@pytest.fixture
def local(tmp_path):
    instance = CodexClient(replace(Settings(), data_dir=tmp_path))
    instance.initialized = True
    instance.process = type("Process", (), {"returncode":None})()
    instance.ensure_started = AsyncMock()
    instance.request = AsyncMock(return_value={"type":"chatgpt", "loginId":"login-1", "authUrl":"https://auth.openai.com/authorize?state=temporary"})
    return instance


@pytest.mark.asyncio
async def test_login_is_single_flight_scoped_and_releases_generation_on_completion(local):
    login = CodexLogin(local)
    first = await login.start()
    assert first["status"] == "waiting"
    assert local.maintenance
    assert await login.start() == first
    assert local.request.await_count == 1
    local.login_completed = {"loginId":"different", "success":True}
    await asyncio.sleep(0.01)
    assert login.snapshot()["status"] == "waiting"
    local.login_completed = {"loginId":"login-1", "success":True}
    await asyncio.wait_for(login.task, 2)
    assert login.snapshot()["status"] == "succeeded"
    assert "url" not in login.snapshot()
    assert not local.maintenance


@pytest.mark.asyncio
async def test_login_busy_cancel_and_untrusted_url_do_not_change_account(local):
    login = CodexLogin(local)
    local.active_generations = 1
    with pytest.raises(CodexError, match="任务"):
        await login.start()
    local.request.assert_not_awaited()
    local.active_generations = 0
    await login.start()
    await asyncio.sleep(0)
    await login.cancel()
    assert login.snapshot()["status"] == "cancelled"
    assert not local.maintenance
    assert local.request.call_args.args[0] == "account/login/cancel"
    local.request.return_value = {"type":"chatgpt", "loginId":"bad", "authUrl":"https://auth.openai.com.evil.invalid/login"}
    with pytest.raises(CodexError):
        await login.start()
    assert not local.maintenance
    assert "evil.invalid" not in json.dumps(login.snapshot())


@pytest.mark.asyncio
async def test_login_failure_hides_sensitive_upstream_error(local):
    local.request.side_effect = CodexError("private-token-should-not-leak")
    login = CodexLogin(local)
    with pytest.raises(CodexError) as error:
        await login.start()
    assert "private-token" not in str(error.value)
    assert "private-token" not in json.dumps(login.snapshot())
    assert not local.maintenance


@pytest.mark.asyncio
async def test_immediate_cancel_releases_login_before_watch_started(local):
    login = CodexLogin(local)
    await login.start()
    await login.cancel()
    assert not local.maintenance
    assert login.login_id is None
    assert local.request.call_args.args[0] == "account/login/cancel"
