import asyncio
import copy
from dataclasses import replace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.deliverables import report_html
from backend.app.furniture_local import (
    FurnitureLocalRequest,
    FurnitureProposal,
    apply_furniture_proposal,
    install_furniture_local,
)
from backend.app.furniture_presets import install_furniture_presets
from backend.app.schemas import ManualEditRequest
from backend.app.skills import SkillRegistry
from backend.app.store import Store
from backend.app.workspace import initialize_workspace
from backend.tests.test_workflow import layout_data, furniture_data


def document():
    furniture = furniture_data()
    furniture["items"][0].update(edit_id="sofa", name="沙发")
    furniture["items"].append(
        {
            **furniture["items"][0],
            "edit_id": "chair",
            "name": "椅子",
            "kind": "chair",
            "x": 5,
            "width": 0.5,
        }
    )
    return {"name": "测试方案", "layout": layout_data(), "furniture": furniture}


def proposal(**changes):
    return FurnitureProposal(
        summary="沙发缩小了 20 厘米",
        x=2,
        y=2,
        elevation=0,
        rotation=0,
        width=1.8,
        depth=0.9,
        height=0.8,
        **changes,
    )


def test_local_change_only_returns_target_and_preserves_inputs():
    body = FurnitureLocalRequest(**document(), target_id="sofa", notes="缩小一点")
    before = body.model_dump()
    result = apply_furniture_proposal(body, proposal())
    assert result["item"]["edit_id"] == "sofa"
    assert result["item"]["width"] == 1.8
    assert body.model_dump() == before
    bad = proposal().model_copy(update={"x": 90})
    with pytest.raises(ValidationError):
        apply_furniture_proposal(body, bad)


def test_link_validation_and_ai_protects_followers():
    data = document()
    data["furniture"]["items"][1]["parent_furniture_id"] = "sofa"
    body = FurnitureLocalRequest(**data, target_id="sofa", notes="缩小一点")
    with pytest.raises(ValueError, match="跟随"):
        apply_furniture_proposal(body, proposal())
    data["furniture"]["items"][0]["parent_furniture_id"] = "chair"
    with pytest.raises(ValidationError, match="循环"):
        ManualEditRequest(**data)
    data["furniture"]["items"][0]["parent_furniture_id"] = "missing"
    with pytest.raises(ValidationError, match="不存在"):
        ManualEditRequest(**data)
    data = document()
    data["furniture"]["items"][1]["edit_id"] = "sofa"
    with pytest.raises(ValidationError, match="重复"):
        ManualEditRequest(**data)


class Library:
    async def resolve_furnishing(self, value):
        return value

    async def catalog(self, **kwargs):
        return [
            {
                "asset_id": "file:aaaaaaaaaaaaaaaaaaaaaaaa",
                "name": "双人沙发",
                "kind": "sofa",
                "dimensions": [1.8, 0.9, 0.8],
            }
        ]

    async def placement(self, asset):
        assert asset == "file:aaaaaaaaaaaaaaaaaaaaaaaa"
        return {
            "kind": "sofa",
            "asset_id": "snapshot:" + "a" * 64,
            "source_asset_id": asset,
            "asset_family": "sofa",
            "diy": None,
        }


def setup_store(tmp_path):
    store = Store(tmp_path / "studio.sqlite3")
    asyncio.run(store.initialize())
    asyncio.run(initialize_workspace(store))
    return store


def test_personal_furniture_is_durable_and_removes_scene_identity(tmp_path):
    store = setup_store(tmp_path)
    app = FastAPI()
    install_furniture_presets(app, store, Library())
    item = {
        **document()["furniture"]["items"][0],
        "parent_furniture_id": "table",
        "edit_locked": True,
        "x": 5,
        "rotation": 90,
    }
    with TestClient(app) as client:
        response = client.post("/api/furniture-presets", json=item)
        assert response.status_code == 201, response.text
        saved = response.json()
        assert saved["item"]["x"] == 0
        assert saved["item"]["rotation"] == 0
        assert "parent_furniture_id" not in saved["item"]
        assert not any(k.startswith("edit_") for k in saved["item"])
        assert (
            client.post(
                "/api/furniture-presets", json={**item, "width": -1}
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/furniture-presets", json={**item, "height": 3, "elevation": 3}
            ).status_code
            == 422
        )
    app2 = FastAPI()
    install_furniture_presets(app2, setup_store(tmp_path), Library())
    with TestClient(app2) as client:
        assert (
            client.get("/api/furniture-presets").json()["items"][0]["id"] == saved["id"]
        )
        assert client.delete("/api/furniture-presets/" + saved["id"]).status_code == 200
        assert client.get("/api/furniture-presets").json()["items"] == []


def test_personal_furniture_limit_is_transactional(tmp_path):
    store = setup_store(tmp_path)

    async def fill():
        db = await store.connect()
        try:
            await db.executemany(
                "INSERT INTO furniture_presets VALUES(?,?,?)",
                [(str(i), "{}", "2026-01-01") for i in range(200)],
            )
            await db.commit()
        finally:
            await db.close()

    asyncio.run(fill())
    app = FastAPI()
    install_furniture_presets(app, store, Library())
    with TestClient(app) as client:
        assert (
            client.post(
                "/api/furniture-presets", json=document()["furniture"]["items"][0]
            ).status_code
            == 409
        )
        assert len(client.get("/api/furniture-presets").json()["items"]) == 200


def test_langgraph_proposal_endpoint_checks_catalog_and_never_writes_job(tmp_path):
    store = setup_store(tmp_path)
    job_id = "a" * 32
    asyncio.run(store.create(job_id, "原设计", {}))
    asyncio.run(store.update(job_id, status="succeeded"))
    original = asyncio.run(store.get(job_id))

    class Client:
        asset = None

        async def generate(self, **kwargs):
            assert kwargs["image"] is None
            assert "furniture-local-edit" in kwargs["instructions"]
            return proposal(asset_id=self.asset).model_dump_json()

    client = Client()

    async def resolve(options, **kwargs):
        assert kwargs["require_image"] is False
        return options

    settings = replace(Settings(), data_dir=tmp_path)
    app = FastAPI()
    install_furniture_local(
        app,
        store,
        settings,
        client,
        SkillRegistry(settings.skills_dir),
        resolve,
        Library(),
    )
    payload = {**document(), "target_id": "sofa", "notes": "缩小一点"}
    with TestClient(app) as http:
        response = http.post(f"/api/jobs/{job_id}/furniture-proposal", json=payload)
        assert response.status_code == 200, response.text
        assert response.json()["item"]["width"] == 1.8
        client.asset = "file:aaaaaaaaaaaaaaaaaaaaaaaa"
        response = http.post(f"/api/jobs/{job_id}/furniture-proposal", json=payload)
        assert response.status_code == 200, response.text
        assert (
            response.json()["item"]["source_asset_id"]
            == "file:aaaaaaaaaaaaaaaaaaaaaaaa"
        )
        client.asset = "file:unknown"
        assert (
            http.post(
                f"/api/jobs/{job_id}/furniture-proposal", json=payload
            ).status_code
            == 422
        )
        locked = copy.deepcopy(payload)
        locked["furniture"]["items"][0]["edit_locked"] = True
        assert (
            http.post(f"/api/jobs/{job_id}/furniture-proposal", json=locked).status_code
            == 422
        )
    assert asyncio.run(store.get(job_id)) == original


def test_report_reuses_plan_and_has_dimensions_without_hidden_furniture():
    doc = document()
    data = {**doc["layout"], "furniture": doc["furniture"]["items"]}
    data["furniture"][1].update(name="隐藏的椅子", edit_hidden=True)
    data["furniture"][0]["name"] = "<script>bad</script>"
    output = report_html(
        {"id": "test", "name": "方案", "created_at": "2026-11-02"}, data
    )
    assert "平面方案图" in output and "8.00 m" in output
    assert "隐藏的椅子" not in output
    assert "<script>bad</script>" not in output
    assert "&lt;script&gt;bad&lt;/script&gt;" in output
    assert "<svg" in output
