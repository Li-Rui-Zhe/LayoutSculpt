import asyncio
import io
import json
import sqlite3
import zipfile
from dataclasses import replace
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.data_maintenance import create_snapshot
from backend.app.diy import DiyService
from backend.app.diy_schema import DiyGenerate
from backend.app.maintenance_routes import install_maintenance_routes
from backend.app.store import Store
from backend.app.surface_ai import SurfaceGenerate, SurfaceGenerationService, install_surface_creation_routes
from backend.tests.test_data_maintenance import seed


def test_backup_download_verifies_contents_and_excludes_live_credentials(tmp_path):
    seed(tmp_path)
    (tmp_path / "ai").mkdir()
    (tmp_path / "ai/secret").write_text("must-not-export")
    identifier = create_snapshot(tmp_path)
    seed(tmp_path, "newer")
    app = FastAPI()
    install_maintenance_routes(app, SimpleNamespace(data_dir=tmp_path))
    with TestClient(app) as client:
        response = client.get(f"/api/maintenance/backups/{identifier}/download")
        assert response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            assert archive.read(f"{identifier}/data/jobs/model.glb") == b"first"
            assert all("/ai/" not in name for name in archive.namelist())
            assert f"{identifier}/manifest.json" in archive.namelist()
        (tmp_path / "backups" / identifier / "data/jobs/model.glb").write_bytes(b"corrupt")
        assert client.get(f"/api/maintenance/backups/{identifier}/download").status_code == 409
        assert client.get("/api/maintenance/backups/unknown/download").status_code == 404
    assert (tmp_path / "jobs/model.glb").read_bytes() == b"newer"


@pytest.mark.asyncio
async def test_only_queued_diy_and_material_requests_resume_after_restart(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path)
    store = Store(settings.db_path)
    await store.initialize()
    diy = DiyService(settings, store, None, None)
    surface = SurfaceGenerationService(settings, store)
    await diy.initialize()
    await surface.initialize()
    diy.schedule = lambda *_: None
    surface.schedule = lambda *_: None
    queued_diy = await diy.create(DiyGenerate(prompt="原木边桌"))
    running_diy = await diy.create(DiyGenerate(prompt="靠背椅子"))
    await diy.transition(running_diy["id"], "running")
    queued_surface = await surface.create(SurfaceGenerate(category="walls", prompt="白色灰泥"))
    running_surface = await surface.create(SurfaceGenerate(category="floor", prompt="浅木地板"))
    await surface.update(running_surface["id"], "running")
    await diy.initialize()
    await surface.initialize()
    scheduled = []
    diy.schedule = lambda identifier, request: scheduled.append(identifier)
    surface.schedule = lambda identifier, request: scheduled.append(identifier)
    await diy.resume_queued()
    await surface.resume_queued()
    assert set(scheduled) == {queued_diy["id"], queued_surface["id"]}
    assert (await diy.get(running_diy["id"]))["status"] == "failed"
    assert (await surface.rows(identifier=running_surface["id"]))[0]["status"] == "failed"


@pytest.mark.asyncio
async def test_graceful_shutdown_preserves_waiting_tasks(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path)
    store = Store(settings.db_path)
    await store.initialize()
    diy = DiyService(settings, store, None, None)
    surface = SurfaceGenerationService(settings, store)
    await diy.initialize()
    await surface.initialize()
    await diy.semaphore.acquire()
    await surface.gate.acquire()
    furniture = await diy.create(DiyGenerate(prompt="原木边桌"))
    material = await surface.create(SurfaceGenerate(category="walls", prompt="白色灰泥"))
    await asyncio.sleep(0)
    await diy.close()
    await surface.close()
    assert (await diy.get(furniture["id"]))["status"] == "queued"
    assert (await surface.rows(identifier=material["id"]))[0]["status"] == "queued"


def test_material_history_pages_have_no_duplicates_at_equal_timestamps(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path)
    store = Store(settings.db_path)
    service = SurfaceGenerationService(settings, store)
    asyncio.run(store.initialize())
    asyncio.run(service.initialize())
    with sqlite3.connect(settings.db_path) as db:
        for number in range(65):
            db.execute("INSERT INTO surface_generations (id,category,prompt,status,created_at,updated_at,method) VALUES(?, 'walls', '白色灰泥', 'succeeded', '2026-01-01', '2026-01-01', 'parametric')", (f"{number:032x}",))
    app = FastAPI()
    install_surface_creation_routes(app, settings, service)
    with TestClient(app) as client:
        found, before = [], None
        while True:
            params = {"category": "walls", **({"before": before} if before else {})}
            response = client.get("/api/materials/generations", params=params)
            assert response.status_code == 200
            page = response.json()
            found.extend(item["id"] for item in page["items"])
            before = page["next_cursor"]
            if not before:
                break
        assert len(found) == len(set(found)) == 65
        assert client.get("/api/materials/generations", params={"category": "walls", "before": json.dumps({"bad": 1})}).status_code == 422
