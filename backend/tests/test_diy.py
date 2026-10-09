"""DIY 数据契约、真实网格及异步素材库生命周期回归。"""

import asyncio
import json
import sqlite3
import struct
import time
from io import BytesIO

import pytest
import trimesh
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.diy_geometry import design_glb
from backend.app.diy_schema import DiyDesign
from backend.app.modeling import build_model
from backend.app.schemas import Furnishing, Layout
from backend.tests.test_workflow import FakeCodex, app_for, layout_data


def design_data():
    return {
        "name": "原木边桌",
        "category": "furniture",
        "parts": [
            {
                "id": "top",
                "name": "桌面",
                "shape": "box",
                "x": 0,
                "y": 0,
                "z": 0.7,
                "width": 1.2,
                "depth": 0.6,
                "height": 0.05,
                "rotation": 0,
                "color": "#b68b60",
                "roughness": 0.6,
                "metallic": 0,
            },
            {
                "id": "base",
                "name": "桌脚",
                "shape": "cylinder",
                "x": 0,
                "y": 0,
                "z": 0,
                "width": 0.15,
                "depth": 0.15,
                "height": 0.7,
                "rotation": 0,
                "color": "#333333",
                "roughness": 0.3,
                "metallic": 0.8,
            },
        ],
    }


def custom_item(design=None):
    return {
        "kind": "custom",
        "name": "边桌",
        "room_id": "living",
        "x": 4,
        "y": 3,
        "width": 2.4,
        "depth": 1.2,
        "height": 1.5,
        "rotation": 30,
        "diy": design or design_data(),
    }


@pytest.mark.parametrize(
    "change",
    [
        lambda d: d.update(script="evil.py"),
        lambda d: d["parts"][0].update(x=float("nan")),
        lambda d: d["parts"][0].update(width=0),
        lambda d: d["parts"][0].update(color="red"),
        lambda d: d["parts"][0].update(shape="script"),
        lambda d: d["parts"][0].update(path="model.obj"),
        lambda d: d["parts"][0].update(width=6, depth=6, rotation=45),
        lambda d: d["parts"].append(d["parts"][0].copy()),
        lambda d: d.update(parts=[]),
        lambda d: d.update(name=" "),
    ],
)
def test_rejects_invalid_geometry_and_executable_fields(change):
    data = design_data()
    change(data)
    with pytest.raises(ValidationError):
        DiyDesign.model_validate(data)


def test_glb_contains_actual_colored_parts_and_correct_dimensions(tmp_path):
    design = DiyDesign.model_validate(design_data())
    data = design_glb(design)
    scene = trimesh.load(BytesIO(data), file_type="glb", force="scene")
    assert scene.extents == pytest.approx([1.2, 0.75, 0.6])
    assert scene.bounds[0][1] == pytest.approx(0)
    assert len(scene.geometry) == 2
    assert any(
        list(m.visual.material.baseColorFactor) == [182, 139, 96, 255]
        for m in scene.geometry.values()
    )
    report = asyncio.run(
        build_model(
            Settings(),
            tmp_path,
            Layout.model_validate(layout_data()),
            Furnishing(items=[custom_item()], notes=[]),
            "natural",
        )
    )
    assert not report["fallback"]
    data = (tmp_path / "model.glb").read_bytes()
    gltf = json.loads(data[20 : 20 + struct.unpack_from("<I", data, 12)[0]])
    parts = [n for n in gltf["nodes"] if n.get("extras", {}).get("diy_part_id")]
    assert len(parts) == 2
    assert all(n["extras"]["furniture_index"] == 0 for n in parts)
    document = json.loads((tmp_path / "layout.json").read_text(encoding="utf-8"))
    assert document["furniture"][0]["diy"] == design.model_dump()


def test_custom_requires_snapshot_and_enforces_scene_budget():
    item = custom_item()
    item.pop("diy")
    with pytest.raises(ValidationError):
        Furnishing(items=[item], notes=[])
    design = design_data()
    design["parts"] = [{**design["parts"][0], "id": f"part{i}"} for i in range(48)]
    with pytest.raises(ValidationError, match="512"):
        Furnishing(items=[custom_item(design) for _ in range(11)], notes=[])


class DiyCodex(FakeCodex):
    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        await asyncio.sleep(self.delay)
        if self.malformed or len(self.calls) == 1:
            return '{"name":"invalid"}'
        return json.dumps(design_data())


def wait_asset(client, asset_id):
    for _ in range(200):
        value = client.get(f"/api/diy/assets/{asset_id}").json()
        if value["status"] not in {"queued", "running"}:
            return value
        time.sleep(0.025)
    raise AssertionError("DIY 未结束")


def test_ai_repairs_invalid_output_and_preserves_selected_text_model(tmp_path):
    codex = DiyCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        response = client.post(
            "/api/diy/generate", json={"prompt": "做个边桌", "model": "text-only"}
        )
        assert response.status_code == 202, response.text
        asset = wait_asset(client, response.json()["id"])
        assert asset["status"] == "ready", asset
        assert len(codex.calls) == 2
        assert all(
            c["model"] == "text-only" and c["image"] is None for c in codex.calls
        )
        assert "diy-contract" in codex.calls[0]["instructions"]
        assert "diy-design" in codex.calls[0]["instructions"]
        assert (
            client.get(f"/api/diy/assets/{asset['id']}/model.glb").content[:4]
            == b"glTF"
        )


def test_save_conflict_archive_and_original_snapshot_isolation(tmp_path):
    with TestClient(app_for(tmp_path, DiyCodex())) as client:
        original = design_data()
        asset = client.post("/api/diy/assets", json={"design": original}).json()
        path = f"/api/diy/assets/{asset['id']}"
        changed = design_data()
        changed["name"] = "新名称"
        changed["parts"][0]["color"] = "#315e49"
        body = {"design": changed, "revision": asset["revision"]}
        assert client.post(path + "/save", json=body).status_code == 200
        assert client.post(path + "/save", json=body).status_code == 409
        assert client.get(path).json()["design"]["name"] == "新名称"
        saved = client.get(path).json()["design"]
        assert saved["parts"][0]["color"] == "#315e49"
        assert saved["parts"][1] == original["parts"][1]
        scene = trimesh.load(
            BytesIO(client.get(path + "/model.glb").content),
            file_type="glb", force="scene",
        )
        colors = [g.visual.material.baseColorFactor.tolist() for g in scene.geometry.values()]
        assert [49, 94, 73, 255] in colors
        assert [51, 51, 51, 255] in colors
        assert client.post(path + "/archive").status_code == 200
        assert client.get(path).status_code == 404
        assert client.get("/api/diy/assets").json()["items"] == []
        assert (
            Furnishing(items=[custom_item(original)], notes=[]).items[0].diy.name
            == "原木边桌"
        )


def test_cancel_failure_effort_and_invalid_model(tmp_path):
    codex = DiyCodex(delay=0.2)
    with TestClient(app_for(tmp_path, codex)) as client:
        response = client.post(
            "/api/diy/generate",
            json={"prompt": "桌子", "model": "test-chosen", "reasoning_effort": "high"},
        )
        path = f"/api/diy/assets/{response.json()['id']}"
        for _ in range(50):
            if codex.calls:
                break
            time.sleep(0.01)
        assert codex.calls[0]["reasoning_effort"] == "high"
        assert client.post(path + "/cancel").json()["status"] == "cancelled"
        time.sleep(0.3)
        assert client.get(path).json()["status"] == "cancelled"
        assert client.get(path + "/model.glb").status_code == 409
        assert (
            client.post(
                "/api/diy/generate", json={"prompt": "桌子", "model": "missing"}
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/diy/generate",
                json={
                    "prompt": "桌子",
                    "model": "test-chosen",
                    "reasoning_effort": "unsupported",
                },
            ).status_code
            == 422
        )
        codex.malformed = True
        codex.delay = 0
        value = client.post("/api/diy/generate", json={"prompt": "桌子"}).json()
        assert wait_asset(client, value["id"])["status"] == "failed"


def test_queue_limit_cancel_queued_and_restart_recovery(tmp_path):
    codex = DiyCodex(delay=30)
    with TestClient(app_for(tmp_path, codex)) as client:
        assets = [
            client.post("/api/diy/generate", json={"prompt": f"边桌{i}"}).json()
            for i in range(8)
        ]
        assert (
            client.post("/api/diy/generate", json={"prompt": "超额"}).status_code == 429
        )
        assert (
            client.post(f"/api/diy/assets/{assets[-1]['id']}/cancel").json()["status"]
            == "cancelled"
        )
        saved = client.post("/api/diy/assets", json={"design": design_data()}).json()
    # 模拟进程被直接终止，数据库残留运行状态。
    with sqlite3.connect(tmp_path / "studio.sqlite3") as db:
        db.execute(
            "UPDATE diy_assets SET status='running' WHERE id=?", (assets[0]["id"],)
        )
    with TestClient(app_for(tmp_path, DiyCodex())) as client:
        interrupted = client.get(f"/api/diy/assets/{assets[0]['id']}").json()
        assert interrupted["status"] == "failed" and "重启" in interrupted["error"]
        assert (
            client.get(f"/api/diy/assets/{saved['id']}").json()["design"]["name"]
            == "原木边桌"
        )


@pytest.mark.asyncio
async def test_cache_lock_isolates_keys_even_with_identical_prefix(tmp_path):
    from backend.app.ai_cache import StageCache

    cache = StageCache(tmp_path)
    key_a, key_b = "aa" + "0" * 62, "aa" + "1" * 62
    async with cache.lock(key_a) as _:
        async with asyncio.timeout(1):
            async with cache.lock(key_b):
                assert cache.lock(key_a).locked()
    assert not cache.locks  # 无等待任务时弱引用锁被回收。
