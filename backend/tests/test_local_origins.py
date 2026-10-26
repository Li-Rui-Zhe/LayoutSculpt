import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.runtime_identity import instance_id, project_id


def test_client_access_is_read_only_and_matches_write_policy(tmp_path):
    settings = Settings(data_dir=tmp_path, frontend_port=5176)
    client = TestClient(create_app(settings, client=object()))
    for origin, allowed in (("http://127.0.0.1:5176", True), ("http://localhost:8000", True), ("http://localhost:5173", False), ("https://other.invalid", False), ("", False)):
        response = client.get("/api/client-access", params={"origin": origin})
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.json() == {
            "application": "layoutsculpt", "protocol": 1,
            "project_id": project_id(), "instance_id": instance_id(settings),
            "origin": origin, "write_allowed": allowed,
        }


def test_configured_port_allows_writes_and_cors_but_rejects_other_sites(tmp_path, monkeypatch):
    monkeypatch.setenv("STUDIO_FRONTEND_PORT", "5176")
    settings = Settings(data_dir=tmp_path)
    assert settings.frontend_port == 5176
    app = create_app(settings, client=object())

    @app.post("/api/origin-test")
    async def write_probe():
        return {"saved": True}

    # Register before the production static-site catch-all mount.
    app.router.routes.insert(0, app.router.routes.pop())
    # No lifespan: probe only the production middleware, without starting AI or tasks.
    client = TestClient(app)
    for origin in (
        "http://127.0.0.1:5176", "http://localhost:5176",
        "http://localhost:8000", "http://127.0.0.1:8000",
    ):
        response = client.post("/api/origin-test", headers={"Origin": origin})
        assert response.status_code == 200
        assert response.json() == {"saved": True}
        assert response.headers["access-control-allow-origin"] == origin
        preflight = client.options("/api/origin-test", headers={
            "Origin": origin, "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        })
        assert preflight.status_code == 200
    for origin in (
        "https://unrelated.invalid", "null", "http://127.0.0.1:5177",
        "http://127.0.0.1:5173", "http://localhost:5173",
        "http://127.0.0.1.evil.invalid:5176", "http://localhost:5176.evil.invalid",
    ):
        response = client.post("/api/origin-test", headers={"Origin": origin})
        assert response.status_code == 403
        assert "http://127.0.0.1:8000" in response.json()["detail"]
        assert "access-control-allow-origin" not in response.headers
        preflight = client.options("/api/origin-test", headers={
            "Origin": origin, "Access-Control-Request-Method": "POST",
        })
        assert preflight.status_code == 400
        assert "access-control-allow-origin" not in preflight.headers
    assert client.post("/api/origin-test").status_code == 200


def test_default_port_is_allowed_only_when_configured(tmp_path, monkeypatch):
    monkeypatch.delenv("STUDIO_FRONTEND_PORT", raising=False)
    settings = Settings(data_dir=tmp_path)
    assert settings.frontend_port == 5173
    client = TestClient(create_app(settings, client=object()))
    for origin, expected in (("http://127.0.0.1:5173", 200), ("http://127.0.0.1:5176", 400)):
        response = client.options("/api/jobs", headers={
            "Origin": origin, "Access-Control-Request-Method": "POST",
        })
        assert response.status_code == expected


@pytest.mark.parametrize("value", ["0", "65536", "-1", "5176.5", "oops", "8000"])
def test_invalid_frontend_port_fails_early(monkeypatch, value):
    monkeypatch.setenv("STUDIO_FRONTEND_PORT", value)
    with pytest.raises(ValueError):
        Settings()
