from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.frontend_files import FrontendFiles


def test_html_entry_never_reuses_a_stale_shell(tmp_path):
    entry = tmp_path / "index.html"
    entry.write_text('<script src="/assets/old.js"></script>', encoding="utf-8")
    app = FastAPI()
    app.mount("/", FrontendFiles(directory=tmp_path, html=True))
    with TestClient(app) as client:
        initial = client.get("/")
        assert initial.headers["cache-control"] == "no-store"
        assert client.get("/index.html").headers["cache-control"] == "no-store"
        entry.write_text(
            '<script src="/assets/new-release.js"></script>', encoding="utf-8"
        )
        refreshed = client.get(
            "/?_ls_build=new-release",
            headers={"If-None-Match": initial.headers["etag"]},
        )
        assert refreshed.status_code == 200
        assert "new-release.js" in refreshed.text
        assert refreshed.headers["cache-control"] == "no-store"


def test_model_and_script_cache_still_support_conditional_requests(tmp_path):
    (tmp_path / "model.glb").write_bytes(b"model")
    app = FastAPI()
    app.mount("/", FrontendFiles(directory=tmp_path, html=True))
    with TestClient(app) as client:
        asset = client.get("/model.glb")
        assert asset.headers.get("cache-control") != "no-store"
        assert (
            client.get(
                "/model.glb", headers={"If-None-Match": asset.headers["etag"]}
            ).status_code
            == 304
        )
