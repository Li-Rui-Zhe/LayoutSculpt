import os
import sqlite3
import time
from contextlib import closing

import pytest

from backend.app.data_maintenance import (
    prepare_data, create_snapshot, restore_snapshot, snapshots, atomic_json,
    verified_snapshot, recover_restore,
)
from backend.app.ai_cache import StageCache
from scripts.report_pipeline import summarize


def seed(root, value="first"):
    root.mkdir(exist_ok=True)
    with closing(sqlite3.connect(root / "studio.sqlite3")) as db:
        db.execute("CREATE TABLE IF NOT EXISTS sample(value TEXT)")
        db.execute("DELETE FROM sample")
        db.execute("INSERT INTO sample VALUES(?)", (value,))
        db.commit()
    (root / "jobs").mkdir(exist_ok=True)
    (root / "jobs/model.glb").write_bytes(value.encode())


def test_upgrade_backup_once_and_restore_with_safety_copy(tmp_path):
    seed(tmp_path)
    (tmp_path / "ai").mkdir()
    (tmp_path / "ai/secret").write_text("do-not-copy")
    prepare_data(tmp_path)
    original = snapshots(tmp_path)[0]["id"]
    assert not (tmp_path / "backups" / original / "data/ai").exists()
    prepare_data(tmp_path)
    assert len(snapshots(tmp_path)) == 1
    seed(tmp_path, "second")
    atomic_json(tmp_path / "maintenance-request.json", {"action": "restore", "id": original})
    prepare_data(tmp_path)
    assert (tmp_path / "jobs/model.glb").read_bytes() == b"first"
    with closing(sqlite3.connect(tmp_path / "studio.sqlite3")) as db:
        assert db.execute("SELECT value FROM sample").fetchone()[0] == "first"
    assert (tmp_path / "ai/secret").read_text() == "do-not-copy"
    assert any(s["reason"] == "before_restore" for s in snapshots(tmp_path))


def test_corrupt_backup_does_not_modify_live_project(tmp_path):
    seed(tmp_path)
    identifier = create_snapshot(tmp_path)
    (tmp_path / "backups" / identifier / "data/jobs/model.glb").write_bytes(b"broken")
    with pytest.raises(ValueError, match="校验失败"):
        restore_snapshot(tmp_path, identifier)
    assert (tmp_path / "jobs/model.glb").read_bytes() == b"first"
    with pytest.raises(ValueError):
        verified_snapshot(tmp_path, "../../other")


def test_restore_interruption_rolls_back_database_and_wal(tmp_path):
    seed(tmp_path)
    original = (tmp_path / "studio.sqlite3").read_bytes()
    rollback = tmp_path / "restore-rollback"
    rollback.mkdir()
    os.replace(tmp_path / "studio.sqlite3", rollback / "studio.sqlite3")
    (rollback / "studio.sqlite3-wal").write_bytes(b"old-wal")
    (tmp_path / "studio.sqlite3").write_bytes(b"new-db")
    atomic_json(tmp_path / "restore-journal.json", {"present": ["studio.sqlite3", "studio.sqlite3-wal", "jobs"]})
    recover_restore(tmp_path)
    assert (tmp_path / "studio.sqlite3").read_bytes() == original
    assert (tmp_path / "studio.sqlite3-wal").read_bytes() == b"old-wal"
    assert (tmp_path / "jobs/model.glb").exists()


def test_retention_keeps_three_completed_backups(tmp_path):
    seed(tmp_path)
    for _ in range(5):
        create_snapshot(tmp_path)
    assert len(snapshots(tmp_path)) == 3


def test_cache_cleanup_keeps_newest_and_never_touches_project(tmp_path):
    seed(tmp_path)
    cache = StageCache(tmp_path / "ai-cache")
    cache.write("a" * 64, {"a": 1})
    old = cache.path("a" * 64)
    os.utime(old, (time.time() - 40 * 86400,) * 2)
    cache.write("b" * 64, {"b": 2})
    cache.prune()
    assert not old.exists()
    assert cache.read("b" * 64) == {"b": 2}
    cache.prune(max_bytes=0)
    assert cache.read("b" * 64) is None
    assert (tmp_path / "jobs/model.glb").exists()


def test_pipeline_report_separates_cache_and_failures(tmp_path):
    folder = tmp_path / "jobs/example"
    folder.mkdir(parents=True)
    atomic_json(folder / "pipeline-metrics.json", {"stages": [
        {"role": "review", "status": "validated", "elapsed_seconds": 10},
        {"role": "review", "status": "validated", "elapsed_seconds": 1, "cache_hit": True},
        {"role": "review", "status": "failed", "elapsed_seconds": 100},
    ]})
    assert len(summarize(tmp_path)["groups"]) == 3


def test_restore_failure_rolls_back_all_replaced_files(tmp_path, monkeypatch):
    seed(tmp_path)
    identifier = create_snapshot(tmp_path)
    seed(tmp_path, "newer")
    replace = os.replace
    def fail_install(source, dest):
        if str(source).endswith("restore-staging" + os.sep + "jobs"):
            raise OSError("simulated disk error")
        return replace(source, dest)
    monkeypatch.setattr(os, "replace", fail_install)
    with pytest.raises(OSError, match="simulated"):
        restore_snapshot(tmp_path, identifier)
    assert (tmp_path / "jobs/model.glb").read_bytes() == b"newer"
    with closing(sqlite3.connect(tmp_path / "studio.sqlite3")) as db:
        assert db.execute("SELECT value FROM sample").fetchone()[0] == "newer"


def test_schedule_and_cancel_never_restore_live_data(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from types import SimpleNamespace
    from backend.app.maintenance_routes import install_maintenance_routes
    seed(tmp_path)
    identifier = create_snapshot(tmp_path)
    seed(tmp_path, "live")
    app = FastAPI()
    install_maintenance_routes(app, SimpleNamespace(data_dir=tmp_path))
    with TestClient(app) as client:
        assert client.post("/api/maintenance", json={"action": "restore", "id": "../outside"}).status_code == 422
        assert client.post("/api/maintenance", json={"action": "restore", "id": identifier}).status_code == 200
        assert (tmp_path / "jobs/model.glb").read_bytes() == b"live"
        assert client.get("/api/maintenance").json()["pending"]["id"] == identifier
        assert client.post("/api/maintenance", json={"action": "cancel"}).status_code == 200
        assert not (tmp_path / "maintenance-request.json").exists()
