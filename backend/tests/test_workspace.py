import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.store import Store
from backend.app.workspace import initialize_workspace, install_workspace_routes


def workspace_client(tmp_path):
    store = Store(tmp_path / "studio.sqlite3")
    asyncio.run(store.initialize())
    asyncio.run(initialize_workspace(store))
    app = FastAPI()
    install_workspace_routes(app, store)
    return TestClient(app), store


def test_draft_conflict_does_not_overwrite_and_survives_reload(tmp_path):
    client, _ = workspace_client(tmp_path)
    path = "/api/drafts/edit:" + "a" * 32
    assert client.get(path).json()["revision"] == 0
    first = client.post(path, json={"revision": 0, "document": {"furniture": [1]}})
    assert first.status_code == 200
    assert (
        client.post(
            path, json={"revision": 0, "document": {"furniture": [2]}}
        ).status_code
        == 409
    )
    second, _ = workspace_client(tmp_path)
    assert second.get(path).json()["document"] == {"furniture": [1]}
    assert (
        second.post(
            path, json={"revision": 1, "document": {"furniture": [3]}}
        ).status_code
        == 200
    )


def test_metadata_rejects_active_archive_and_preserves_job(tmp_path):
    client, store = workspace_client(tmp_path)
    identifier = "b" * 32
    asyncio.run(store.create(identifier, "原名称", {}))
    path = f"/api/jobs/{identifier}/metadata"
    assert client.post(path, json={"archived": True}).status_code == 409
    assert client.post(path, json={"name": "新名称"}).status_code == 200
    asyncio.run(store.update(identifier, status="succeeded"))
    assert client.post(path, json={"archived": True}).status_code == 200
    assert client.get("/api/project-metadata").json()["items"][0]["archived"] == 1
    assert client.post(path, json={"archived": False}).status_code == 200
    assert asyncio.run(store.get(identifier))["name"] == "新名称"


def test_draft_rejects_invalid_key_and_large_payload(tmp_path):
    client, _ = workspace_client(tmp_path)
    assert client.get("/api/drafts/untrusted").status_code == 422
    assert (
        client.post(
            "/api/drafts/diy:new",
            json={"revision": 0, "document": {"v": "中" * 800000}},
        ).status_code
        == 413
    )
