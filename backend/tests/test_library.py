import asyncio
import json
import struct
from dataclasses import replace

import pytest
import trimesh
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.library import LibraryService
from backend.app.library_models import load_glb, snapshot_file
from backend.app.modeling import build_model
from backend.app.schemas import Furnishing, Layout
from backend.tests.test_diy import design_data
from backend.tests.test_workflow import (
    FakeCodex,
    app_for,
    create_job,
    furniture_data,
    layout_data,
    wait_job,
)


def test_library_indexes_real_files_diy_and_completed_jobs(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        asset = client.post("/api/diy/assets", json={"design": design_data()}).json()
        job = wait_job(client, create_job(client)["id"])
        result = client.get("/api/library/assets")
        assert result.status_code == 200
        items = result.json()["items"]
        assert {"builtin", "sample", "diy", "generated"} <= {i["source"] for i in items}
        assert len({i["id"] for i in items}) == len(items)
        diy = next(i for i in items if i.get("asset_id") == asset["id"])
        assert diy["dimensions"] == [1.2, 0.6, 0.75]
        assert client.get(diy["model_url"]).content.startswith(b"glTF")
        builtin = next(i for i in items if i["source"] == "builtin")
        download = client.get(builtin["model_url"])
        assert download.content.startswith(b"glTF")
        assert download.headers["content-type"] == "model/gltf-binary"
        assert all("path" not in i for i in items)
        assert any(i.get("job_id") == job["id"] for i in items)
        client.post(f"/api/diy/assets/{asset['id']}/archive")
        assert not any(
            i.get("asset_id") == asset["id"]
            for i in client.get("/api/library/assets").json()["items"]
        )
        assert client.get("/api/library/files/nonexistent/model.glb").status_code == 404
        assert (
            client.get("/api/library/files/%2E%2E%2Fsecret/model.glb").status_code
            == 404
        )


def test_file_scan_handles_extra_glbs_missing_files_and_no_path_input(tmp_path):
    folder = tmp_path / "assets"
    folder.mkdir()
    (folder / "extra.GLB").write_bytes(b"glTF")
    (folder / "private.txt").write_text("not a model")
    service = LibraryService(Settings(), None, None, roots=[(folder, "builtin")])
    files = service.files()
    assert len(files) == 1
    identifier, entry = next(iter(files.items()))
    assert len(identifier) == 24
    assert entry["item"]["filename"] == "extra.GLB"
    (folder / "extra.GLB").unlink()
    assert not service.files()


def test_placement_api_returns_independent_diy_and_glb_snapshots(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        diy = client.post("/api/diy/assets", json={"design": design_data()}).json()
        items = client.get("/api/library/assets").json()["items"]
        item = next(i for i in items if i.get("kind") == "chair")
        placed = client.post("/api/library/placement", json={"id": item["id"]})
        assert placed.status_code == 200, placed.text
        placed = placed.json()
        assert placed["asset_id"].startswith("snapshot:")
        assert snapshot_file(tmp_path / "library", placed["asset_id"]).is_file()
        diy_copy = client.post(
            "/api/library/placement", json={"id": f"diy:{diy['id']}"}
        ).json()
        assert diy_copy["kind"] == "custom"
        assert diy_copy["diy"]["name"] == design_data()["name"]
        client.post(f"/api/diy/assets/{diy['id']}/archive")
        assert Furnishing(items=[{**diy_copy, "room_id": "living"}], notes=[])
        assert (
            client.post("/api/library/placement", json={"id": "job:any"}).status_code
            == 422
        )
        assert (
            client.post(
                "/api/library/placement", json={"id": "file:../../secret"}
            ).status_code
            == 404
        )


def test_external_glb_snapshot_survives_source_removal_and_real_build(tmp_path):
    folder = tmp_path / "assets"
    folder.mkdir()
    mesh = trimesh.creation.box(extents=[1, 0.8, 0.5])
    mesh.apply_translation([15, 7, -9])
    source = folder / "external.glb"
    source.write_bytes(trimesh.Scene(mesh).export(file_type="glb"))
    settings = replace(Settings(), data_dir=tmp_path / "data")
    library = LibraryService(settings, None, None, roots=[(folder, "builtin")])
    identifier = next(iter(library.files().values()))["item"]["id"]
    template = asyncio.run(library.placement(identifier))
    assert template["kind"] == "model"
    assert [template[k] for k in ["width", "depth", "height"]] == pytest.approx(
        [1, 0.5, 0.8]
    )
    source.unlink()
    item = {
        **template,
        "room_id": "living",
        "x": 4,
        "y": 3,
        "width": 2,
        "depth": 1,
        "height": 1.6,
        "rotation": 90,
    }
    plan = asyncio.run(library.resolve_furnishing(Furnishing(items=[item], notes=[])))
    workspace = tmp_path / "job"
    workspace.mkdir()
    report = asyncio.run(
        build_model(
            settings, workspace, Layout.model_validate(layout_data()), plan, "natural"
        )
    )
    assert report["instances"][0]["asset_id"] == item["asset_id"]
    scene = trimesh.load(workspace / "model.glb", force="scene")
    parts = []
    for node in scene.graph.nodes_geometry:
        if node.startswith("素材家具_"):
            transform, geometry = scene.graph[node]
            part = scene.geometry[geometry].copy()
            part.apply_transform(transform)
            parts.append(part)
    actual = trimesh.util.concatenate(parts)
    assert actual.extents == pytest.approx([1, 1.6, 2], abs=1e-5)
    assert actual.bounds[0][1] == pytest.approx(0.035, abs=1e-5)
    snapshot_file(settings.data_dir / "library", item["asset_id"]).write_bytes(
        b"corrupted"
    )
    with pytest.raises(Exception, match="校验失败"):
        asyncio.run(library.resolve_furnishing(plan))


def test_glb_external_resources_are_rejected():
    content = json.dumps(
        {
            "asset": {"version": "2.0"},
            "buffers": [{"uri": "../../secret", "byteLength": 8}],
        }
    ).encode()
    content += b" " * (-len(content) % 4)
    data = (
        struct.pack("<4sIIII", b"glTF", 2, 20 + len(content), len(content), 0x4E4F534A)
        + content
    )
    with pytest.raises(ValueError, match="内嵌"):
        load_glb(data)


@pytest.mark.parametrize("source", ["builtin", "diy"])
def test_ai_selects_from_shared_catalog_and_persists_snapshot(tmp_path, source):
    class LibraryCodex(FakeCodex):
        async def generate(self, **kwargs):
            if kwargs["schema"]["title"] != "Furnishing":
                return await super().generate(**kwargs)
            self.calls.append(kwargs)
            payload = json.loads(
                kwargs["prompt"].split("输入结构数据：\n", 1)[1].strip()
            )
            chosen = next(
                i
                for i in payload["furniture_assets"]
                if (
                    i["asset_id"].startswith("diy:")
                    if source == "diy"
                    else i["kind"] == "sofa"
                )
            )
            plan = furniture_data()
            plan["items"][0]["asset_id"] = chosen["asset_id"]
            plan["items"][0]["kind"] = chosen["kind"]
            return json.dumps(plan)

    codex = LibraryCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        asset = client.post("/api/diy/assets", json={"design": design_data()}).json()
        if source == "diy":
            client.post("/api/drafts/library:new", json={"revision": 0,
                "document": {"aiEnabled": [f"diy:{asset['id']}"]}})
        job = wait_job(client, create_job(client)["id"])
        assert job["status"] == "succeeded", job
        document = client.get(job["result"]["layout_url"]).json()
        item = document["furniture"][0]
        if source == "diy":
            assert item["kind"] == "custom" and item["asset_id"] is None
            assert len(item["diy"]["parts"]) == 2
        else:
            assert item["asset_id"].startswith("snapshot:")
