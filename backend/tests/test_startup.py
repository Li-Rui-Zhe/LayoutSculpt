import os
import socket
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from scripts import startup
from backend.app.runtime_identity import instance_id, project_id


@pytest.fixture
def setup(tmp_path, monkeypatch):
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist/index.html").write_text("ready")
    vite = tmp_path / "node_modules/vite/bin/vite.js"
    vite.parent.mkdir(parents=True)
    vite.touch()
    settings = SimpleNamespace(frontend_port=5176, data_dir=tmp_path / "data")
    monkeypatch.setattr(startup, "ROOT", tmp_path)
    monkeypatch.setattr(startup, "load_settings", lambda: settings)
    monkeypatch.setattr(startup.shutil, "which", lambda _: "node")
    return settings


def test_reuses_healthy_project_without_spawning_or_stopping(setup, monkeypatch):
    monkeypatch.setattr(startup, "inspect_service", lambda *_: "ready")
    launcher = startup.Launcher()
    launcher.spawn = Mock(side_effect=AssertionError("must not spawn"))
    assert launcher.start() == startup.BASE
    assert launcher.reused
    assert launcher.owned == []
    launcher.stop_owned()


@pytest.mark.parametrize("state", ["occupied", "other-project", "starting"])
def test_conflict_never_starts_or_kills_services(setup, monkeypatch, state):
    monkeypatch.setattr(startup, "inspect_service", lambda *_: state)
    monkeypatch.setattr(startup.subprocess, "run", Mock(side_effect=AssertionError("must not kill")))
    launcher = startup.Launcher()
    launcher.spawn = Mock(side_effect=AssertionError("must not spawn"))
    with pytest.raises(startup.StartupError, match="8000"):
        launcher.start()


def test_frontend_conflict_is_detected_before_starting_backend(setup, monkeypatch):
    monkeypatch.setattr(startup, "inspect_service", lambda _, frontend=False: "occupied" if frontend else "free")
    launcher = startup.Launcher("all")
    launcher.spawn = Mock(side_effect=AssertionError("must not spawn backend"))
    with pytest.raises(startup.StartupError, match="5176"):
        launcher.start()


def test_proxy_mismatch_rejects_reuse(setup, monkeypatch):
    monkeypatch.setattr(startup, "inspect_service", lambda *_: "ready")
    monkeypatch.setattr(startup, "read_json", lambda _: {"instance_id": "other", "write_allowed": True})
    with pytest.raises(startup.StartupError, match="不一致"):
        startup.Launcher("all").start()


def test_failed_new_frontend_cleans_only_owned_process(setup, monkeypatch):
    monkeypatch.setattr(startup, "inspect_service", lambda _, frontend=False: "free" if frontend else "ready")
    launcher = startup.Launcher("all")
    process = Mock(pid=123456789)
    process.poll.return_value = None
    def spawn(*_):
        launcher.owned.append(process)
        return process
    launcher.spawn = spawn
    launcher.wait_ready = Mock(side_effect=startup.StartupError("启动失败"))
    run = Mock()
    monkeypatch.setattr(startup.subprocess, "run", run)
    if os.name != "nt":
        monkeypatch.setattr(os, "killpg", run)
    with pytest.raises(startup.StartupError, match="启动失败"):
        launcher.start()
    assert run.call_count == 1
    assert str(process.pid) in str(run.call_args)
    assert launcher.owned == []


def test_identity_rejects_other_project_and_data_directory(setup, monkeypatch):
    info = {"application": "layoutsculpt", "protocol": 1, "project_id": project_id(), "instance_id": instance_id(setup)}
    monkeypatch.setattr(startup, "read_json", lambda url: {"status": "ok"} if url.endswith("health") else info)
    assert startup.inspect_service(setup) == "ready"
    info["instance_id"] = "other-data-dir"
    assert startup.inspect_service(setup) == "other-project"
    info["instance_id"] = instance_id(setup)
    info["project_id"] = "other-project"
    assert startup.inspect_service(setup) == "other-project"


def test_occupied_unknown_service_stays_running(setup, monkeypatch):
    monkeypatch.setattr(startup, "read_json", lambda _: None)
    with socket.socket() as owner:
        owner.bind(("127.0.0.1", 0))
        owner.listen()
        setup.frontend_port = owner.getsockname()[1]
        assert startup.inspect_service(setup, True) == "occupied"
        assert owner.fileno() != -1
    assert startup.inspect_service(setup, True) == "free"


def test_concurrent_start_is_rejected_and_lock_released(tmp_path, monkeypatch):
    monkeypatch.setattr(startup, "ROOT", tmp_path)
    with startup.startup_lock():
        with pytest.raises(startup.StartupError, match="另一个启动窗口"):
            with startup.startup_lock():
                pytest.fail("lock should not be acquired")
    with startup.startup_lock():
        pass


def test_retry_reloads_env_and_preserves_inherited_overrides(tmp_path, monkeypatch):
    monkeypatch.setattr(startup, "ROOT", tmp_path)
    monkeypatch.setenv("STUDIO_FRONTEND_PORT", "5173")
    monkeypatch.setattr(startup, "_inherited_env", set(os.environ) - {"STUDIO_FRONTEND_PORT"})
    monkeypatch.setattr(startup, "_dotenv_keys", {"STUDIO_FRONTEND_PORT"})
    config = tmp_path / ".env"
    config.write_text("STUDIO_FRONTEND_PORT=5176\n")
    assert startup.load_settings().frontend_port == 5176
    config.write_text("STUDIO_FRONTEND_PORT=5180\n")
    assert startup.load_settings().frontend_port == 5180
    config.write_text("")
    assert startup.load_settings().frontend_port == 5173
    monkeypatch.setenv("STUDIO_FRONTEND_PORT", "5190")
    startup._inherited_env.add("STUDIO_FRONTEND_PORT")
    config.write_text("STUDIO_FRONTEND_PORT=5176\n")
    assert startup.load_settings().frontend_port == 5190


def test_start_timeout_and_exit_are_actionable(setup, tmp_path):
    launcher = startup.Launcher()
    process = Mock()
    process.poll.return_value = None
    with pytest.raises(startup.StartupError, match="未就绪"):
        launcher.wait_ready(setup, process, timeout=0)
    log = tmp_path / "failed.log"
    log.write_text("ModuleNotFoundError: example")
    launcher.logs.append(log)
    process.poll.return_value = 1
    process.returncode = 1
    with pytest.raises(startup.StartupError, match="缺少依赖"):
        launcher.wait_ready(setup, process)
