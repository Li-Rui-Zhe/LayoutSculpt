import asyncio
import base64
import hashlib
import io
import json
import tarfile
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import codex_installer
from backend.app.ai_credentials import atomic_private_write
from backend.app.codex import CodexClient, CodexError
from backend.app.codex_installer import CodexInstaller
from backend.app.codex_runtime import CodexRuntime
from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.runtime_downloads import Downloads, InstallError, extract_archive
from backend.app.toolchain_paths import architecture_label, read_active, selected_tool


def archive_file(name="package/vendor/codex/codex.exe", content=b"test-native-binary"):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        member = tarfile.TarInfo(name)
        member.size, member.mode = len(content), 0o755
        archive.addfile(member, io.BytesIO(content))
    return output.getvalue()


@pytest.fixture
def installer(tmp_path, monkeypatch):
    original = tmp_path / "original/codex.exe"
    original.parent.mkdir()
    original.write_bytes(b"original-cli-must-be-preserved")
    settings = replace(
        Settings(), data_dir=tmp_path / "data", codex_command=str(original)
    )
    local = CodexClient(settings)
    local.stop = AsyncMock()
    runtime = CodexRuntime(settings, local)

    async def inspect():
        runtime.report = {"status": "ready", "version": "0.164.0"}
        return {"diagnostics": {"status": "ready", "version": "0.164.0"}}

    runtime.inspect = AsyncMock(side_effect=inspect)
    instance = CodexInstaller(settings, runtime)
    instance.verify = AsyncMock()
    monkeypatch.setattr(codex_installer, "host_target", lambda: ("win32", "x64"))
    calls = []
    payload = archive_file()

    async def handle(request):
        calls.append(str(request.url))
        assert "authorization" not in request.headers
        assert "cookie" not in request.headers
        if request.url.path.endswith("latest"):
            return httpx.Response(
                200,
                json={
                    "name": "@openai/codex",
                    "version": "0.164.0",
                    "optionalDependencies": {
                        "@openai/codex-win32-x64": "npm:@openai/codex@0.164.0-win32-x64"
                    },
                },
            )
        if request.url.path.endswith("0.164.0-win32-x64"):
            return httpx.Response(
                200,
                json={
                    "name": "@openai/codex",
                    "version": "0.164.0-win32-x64",
                    "dist": {
                        "tarball": "https://registry.npmjs.org/@openai/codex/-/native.tgz",
                        "integrity": "sha512-"
                        + base64.b64encode(hashlib.sha512(payload).digest()).decode(),
                    },
                },
            )
        return httpx.Response(200, content=payload)

    instance.downloads.transport = httpx.MockTransport(handle)
    instance.calls = calls
    return instance


@pytest.mark.asyncio
async def test_download_verify_activate_persists_without_touching_original(installer):
    result = await installer.start()
    assert result["job"]["status"] == "queued"
    await installer.task
    assert installer.job["status"] == "succeeded"
    path = selected_tool(installer.settings.data_dir, "codex")
    assert path and Path(path).read_bytes() == b"test-native-binary"
    assert (
        Path(installer.settings.codex_command).read_bytes()
        == b"original-cli-must-be-preserved"
    )
    assert CodexClient(installer.settings).command == path
    assert installer.snapshot()["can_use_system"]
    assert not installer.snapshot()["can_rollback"]
    assert not installer.runtime.local.maintenance
    installer.verify.assert_awaited_once()
    assert not (installer.settings.data_dir / "ai/connections.json").exists()


@pytest.mark.asyncio
async def test_failed_connection_restores_previous_selection_and_cleans_candidate(
    installer,
):
    installer.runtime.inspect = AsyncMock(
        side_effect=[
            {"diagnostics": {"status": "error", "code": "incompatible"}},
            {"diagnostics": {"status": "ready"}},
        ]
    )
    await installer.start()
    await installer.task
    assert installer.job["status"] == "failed"
    assert not read_active(installer.settings.data_dir)
    assert installer.runtime.local.command == installer.settings.codex_command
    assert not installer.runtime.local.maintenance
    assert not list(
        (installer.root / "packages/codex").glob("*/package/vendor/codex/codex.exe")
    )
    assert installer.runtime.inspect.await_count == 2


@pytest.mark.asyncio
async def test_restore_system_cli_and_previous_managed_version(installer, monkeypatch):
    await installer.start()
    await installer.task
    first = selected_tool(installer.settings.data_dir, "codex")
    await installer.start()
    await installer.task
    second = selected_tool(installer.settings.data_dir, "codex")
    assert first != second
    assert installer.snapshot()["can_rollback"]
    await installer.start("rollback")
    await installer.task
    assert selected_tool(installer.settings.data_dir, "codex") == first
    monkeypatch.setattr(
        codex_installer, "cli_version", AsyncMock(return_value="0.162.1")
    )
    await installer.start("system")
    await installer.task
    assert installer.job["status"] == "succeeded"
    assert selected_tool(installer.settings.data_dir, "codex") is None
    assert installer.runtime.local.command == installer.settings.codex_command


@pytest.mark.asyncio
async def test_update_downloads_while_busy_and_switches_only_when_idle(
    installer,
):
    installer.runtime.local.active_generations = 1
    original = installer.runtime.local.command
    await installer.start()
    async with asyncio.timeout(5):
        while installer.job.get("stage") != "waiting_idle":
            await asyncio.sleep(0.02)
    assert installer.calls
    assert installer.runtime.local.command == original
    assert not installer.runtime.local.maintenance
    installer.runtime.local.active_generations = 0
    await installer.task
    assert installer.job["status"] == "succeeded"
    installer.runtime.local.maintenance = True
    with pytest.raises(CodexError, match="更新环境"):
        await installer.runtime.local.generate()


@pytest.mark.asyncio
async def test_jobs_are_single_flight_and_survive_http_request_lifetime(installer):
    waiting = asyncio.Event()

    async def install():
        await waiting.wait()

    installer.install = install
    a = await installer.start()
    b = await installer.start()
    assert a["job"]["id"] == b["job"]["id"]
    with pytest.raises(InstallError, match="正在进行"):
        await installer.start("rollback")
    await asyncio.sleep(0)
    await installer.cancel()
    assert installer.job["status"] == "cancelled"


@pytest.mark.asyncio
async def test_unlogged_new_install_is_kept_with_explicit_login_instruction(installer):
    installer.runtime.inspect = AsyncMock(
        return_value={"diagnostics": {"status": "error", "code": "authentication"}}
    )
    await installer.start()
    await installer.task
    assert installer.job["status"] == "succeeded"
    assert installer.job["needs_login"] is True
    assert "登录" in installer.job["message"]
    assert selected_tool(installer.settings.data_dir, "codex")


@pytest.mark.asyncio
async def test_explicit_isolation_persists_and_rollback_restores_environment(installer):
    await installer.start("install")
    await installer.task
    assert installer.runtime.local.environment_mode == "shared"
    await installer.start("isolated")
    await installer.task
    assert installer.job["status"] == "succeeded"
    assert installer.runtime.local.environment_mode == "isolated"
    assert CodexClient(installer.settings).environment_mode == "isolated"
    assert read_active(installer.settings.data_dir)["codex"]["previous"]["config_mode"] == "shared"
    await installer.start("rollback")
    await installer.task
    assert installer.runtime.local.environment_mode == "shared"


@pytest.mark.asyncio
async def test_write_failure_rolls_back_and_reports_only_curated_message(
    installer, monkeypatch
):
    original = installer.write_active
    calls = 0

    def write(data):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise OSError("private-token-in-exception")
        return original(data)

    monkeypatch.setattr(installer, "write_active", write)
    await installer.start()
    await installer.task
    assert installer.job["status"] == "failed"
    assert "private-token" not in json.dumps(installer.snapshot())
    assert not installer.runtime.local.maintenance
    assert not read_active(installer.settings.data_dir)


@pytest.mark.asyncio
async def test_busy_at_activation_preserves_original(installer):
    async def verify(*args):
        installer.runtime.local.active_generations = 1

    installer.verify = verify
    await installer.start()
    async with asyncio.timeout(5):
        while installer.job.get("stage") != "waiting_idle":
            await asyncio.sleep(0.02)
    await installer.cancel()
    assert installer.job["status"] == "cancelled"
    assert not selected_tool(installer.settings.data_dir, "codex")
    installer.runtime.local.stop.assert_not_called()


@pytest.mark.asyncio
async def test_download_hash_mismatch_and_redirect_never_activate(tmp_path):
    downloads = Downloads(tmp_path)
    digest = "sha512-" + base64.b64encode(hashlib.sha512(b"expected").digest()).decode()
    progress = AsyncMock()
    downloads.transport = httpx.MockTransport(
        lambda _: httpx.Response(200, content=b"incorrect")
    )
    with pytest.raises(InstallError, match="完整性校验失败"):
        await downloads.archive("https://registry.npmjs.org/file.tgz", digest, progress)
    assert not list((tmp_path / "downloads").glob("*.partial"))
    downloads.transport = httpx.MockTransport(
        lambda _: httpx.Response(
            302, headers={"location": "https://untrusted.invalid/evil"}
        )
    )
    with pytest.raises(InstallError, match="受信任"):
        await downloads.metadata("https://registry.npmjs.org/file.tgz")


@pytest.mark.asyncio
async def test_download_cancel_removes_partial_and_reaps_stream(tmp_path):
    downloads = Downloads(tmp_path)
    entered = asyncio.Event()

    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"x" * (256 * 1024)
            entered.set()
            await asyncio.Event().wait()

    downloads.transport = httpx.MockTransport(
        lambda _: httpx.Response(200, stream=Stream())
    )
    digest = (
        "sha512-"
        + base64.b64encode(hashlib.sha512(b"never-complete").digest()).decode()
    )
    task = asyncio.create_task(
        downloads.archive("https://registry.npmjs.org/file.tgz", digest, AsyncMock())
    )
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not list((tmp_path / "downloads").glob("*.partial"))


@pytest.mark.parametrize(
    "name", ["../escape.exe", "/escape.exe", "C:/escape.exe", "..\\escape.exe"]
)
def test_archive_paths_cannot_escape_install_directory(tmp_path, name):
    archive = tmp_path / "payload.tgz"
    archive.write_bytes(archive_file(name))
    with pytest.raises(InstallError, match="路径"):
        extract_archive(archive, tmp_path / "install")
    assert not (tmp_path / "escape.exe").exists()


def test_active_pointer_rejects_escape_and_missing_previous(installer):
    atomic_private_write(
        installer.root / "active.json",
        json.dumps({"codex": {"path": "../../original/codex.exe"}}).encode(),
    )
    assert selected_tool(installer.settings.data_dir, "codex") is None
    assert selected_tool(installer.settings.data_dir, "codex", entry=None) is None
    assert architecture_label("AMD64") == "x64（64 位）"


def test_only_cli_actions_are_exposed_and_origin_is_enforced(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path)
    local = CodexClient(settings)
    app = create_app(settings, client=local)
    with TestClient(app) as client:
        status = client.get("/api/ai/codex/installation")
        assert status.status_code == 200 and status.json()["job"] is None
        assert (
            client.post("/api/ai/codex/install", json={"action": "python"}).status_code
            == 422
        )
        assert (
            client.post(
                "/api/ai/codex/install",
                json={"action": "install", "url": "https://untrusted.invalid"},
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/ai/codex/install",
                json={"action": "install"},
                headers={"origin": "https://untrusted.invalid"},
            ).status_code
            == 403
        )
        assert client.get("/api/ai/environment").status_code == 404
        assert app.state.codex_installer.task is None
