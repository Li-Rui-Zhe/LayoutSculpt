import io
import json
import numpy as np
import trimesh

from backend.app.schemas import Layout
from backend.app.diy_schema import DiyDesign
from backend.app.diy_geometry import design_glb
from backend.app.glb_builder import Builder
from backend.app.config import Settings
from backend.app.consistency import verify_export
from backend.app.deliverables import report_html
from backend.tests.test_workflow import layout_data
from backend.tests.test_workflow import app_for, FakeCodex, create_job, wait_job
from fastapi.testclient import TestClient
from backend.app.project_transfer import read_project_archive
from backend.tests.test_diy import design_data


def test_wall_sides_keep_openings_and_structural_integrity(tmp_path):
    data = layout_data()
    data["walls"][0].update(material_left="wall-oak", material_right="wall-lime")
    data["rooms"][0].update(floor_rotation=45, floor_scale=0.5)
    data = Layout.model_validate(data).model_dump()
    data.update(style="natural", furniture_mode="basic", furniture=[])
    Builder(data, Settings().furniture_catalog).build(tmp_path)
    assert verify_export(data, tmp_path / "model.glb")["geometry_verified"]
    scene = trimesh.load(tmp_path / "model.glb", force="scene")
    sides = set()
    for (_, node), edge in scene.graph.transforms.edge_data.items():
        meta = edge.get("metadata", {})
        if meta.get("surface_overlay"):
            sides.add(meta["wall_side"])
            mesh = scene.geometry[scene.graph[node][1]]
            assert mesh.visual.material.baseColorTexture is not None
            assert np.isfinite(mesh.visual.uv).all()
    assert sides == {"left", "right"}


def test_diy_rounded_and_cone_material_export():
    part = dict(
        id="p",
        name="桌面",
        shape="rounded_box",
        x=0,
        y=0,
        z=0,
        width=1,
        depth=0.6,
        height=0.2,
        rotation=0,
        color="#c8b895",
        roughness=0.7,
        metallic=0,
        material_id="wall-oak",
    )
    for shape in ["rounded_box", "cone"]:
        design = DiyDesign.model_validate(
            dict(name="测试家具", category="furniture", parts=[dict(part, shape=shape)])
        )
        scene = trimesh.load(
            io.BytesIO(design_glb(design)), file_type="glb", force="scene"
        )
        assert np.allclose(scene.extents, [1, 0.2, 0.6], atol=0.006)
        assert all(
            mesh.visual.material.baseColorTexture is not None
            for mesh in scene.geometry.values()
        )


def test_report_escapes_names_and_includes_deliverables():
    data = layout_data()
    data["rooms"][0]["name"] = "<script>bad</script>"
    data["furniture"] = []
    result = report_html(
        dict(id="a" * 32, name="<img onerror=bad>", created_at="2026-10-10", result={}),
        data,
    )
    assert "<script>bad" not in result
    assert "&lt;script&gt;bad" in result
    assert "打印 / 保存为 PDF" in result


def test_drawing_exports_separate_openings_and_escape_labels():
    from backend.app.plan_drawing import plan_svg, plan_dxf, segments

    data = layout_data()
    data["rooms"][0]["name"] = "<script>test</script>"
    svg = plan_svg(data)
    dxf = plan_dxf(data)
    assert "&lt;script&gt;" in svg and "<script>" not in svg
    assert 'xmlns="http://www.w3.org/2000/svg"' in svg
    assert "$INSUNITS\r\n70\r\n4" in dxf and dxf.endswith("EOF\r\n")
    for layer, a, b, _ in segments(data):
        assert layer in {"WALLS", "DOORS", "WINDOWS", "PASSAGES"}
        assert a != b


def test_bundle_can_restore_without_overwriting_original_and_incremental_list(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        job = wait_job(client, create_job(client)["id"])
        changes = client.get("/api/jobs/changes").json()
        assert job["id"] in {v["id"] for v in changes["items"]}
        assert (
            client.get(
                "/api/jobs/changes", params={"cursor": changes["cursor"]}
            ).json()["items"]
            == []
        )
        package = client.get(f"/api/jobs/{job['id']}/bundle")
        assert package.status_code == 200
        layout, _, _, _, _, _ = read_project_archive(package.content)
        assert layout.title
        restored = client.post(
            "/api/projects/import",
            files={"file": ("project.zip", package.content, "application/zip")},
        )
        assert restored.status_code == 201, restored.text
        assert restored.json()["id"] != job["id"]
        assert wait_job(client, restored.json()["id"])["status"] == "succeeded"
        assert client.get(f"/api/jobs/{job['id']}").json()["status"] == "succeeded"
        for extension in ["svg", "dxf"]:
            assert (
                client.get(f"/api/jobs/{job['id']}/drawing/{extension}").status_code
                == 200
            )


def test_project_archive_is_atomic_across_versions(tmp_path):
    import asyncio

    app = app_for(tmp_path, FakeCodex())
    with TestClient(app) as client:
        job = wait_job(client, create_job(client)["id"])
        identifier = "d" * 32
        asyncio.run(app.state.store.create(identifier, "进行中的版本", {}))
        folder = app.state.settings.workspace(identifier)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "rebuild-seed.json").write_text(
            json.dumps({"edited_of": job["id"]}), encoding="utf-8"
        )
        path = f"/api/projects/{job['id']}/archive"
        assert client.post(path, json={"archived": True}).status_code == 409
        assert client.get("/api/project-metadata").json()["items"] == []
        asyncio.run(app.state.store.update(identifier, status="cancelled"))
        assert client.post(path, json={"archived": True}).json()["count"] == 2
        assert all(
            i["archived"] == 1
            for i in client.get("/api/project-metadata").json()["items"]
        )
        assert client.post(path, json={"archived": False}).status_code == 200
        assert all(
            i["archived"] == 0
            for i in client.get("/api/project-metadata").json()["items"]
        )


def test_diy_history_and_restore_are_recoverable(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        design = design_data()
        asset = client.post("/api/diy/assets", json={"design": design}).json()
        design["name"] = "修改后的家具"
        path = f"/api/diy/assets/{asset['id']}"
        assert (
            client.post(
                path + "/save", json={"design": design, "revision": asset["revision"]}
            ).status_code
            == 200
        )
        versions = client.get(path + "/history").json()["items"]
        assert len(versions) == 1
        assert versions[0]["design"]["name"] != design["name"]
        assert client.post(path + "/archive").status_code == 200
        assert any(
            v["id"] == asset["id"]
            for v in client.get("/api/diy/assets?archived=true").json()["items"]
        )
        assert client.post(path + "/restore").status_code == 200
        assert client.get(path).json()["design"]["name"] == design["name"]


def test_creation_key_retries_return_same_job(tmp_path):
    import PIL.Image

    content = io.BytesIO()
    PIL.Image.new("RGB", (64, 64), "white").save(content, format="PNG")
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        headers = {"Idempotency-Key": "test-request-key-001"}

        def upload():
            return client.post(
                "/api/jobs",
                headers=headers,
                files={"file": ("plan.png", content.getvalue(), "image/png")},
            )

        first = upload()
        second = upload()
        assert first.status_code == second.status_code == 201
        assert first.json()["id"] == second.json()["id"]
        assert len(client.get("/api/jobs").json()["items"]) == 1
        job = wait_job(client, first.json()["id"])
        data = client.get(f"/api/jobs/{job['id']}/artifacts/layout.json").json()
        payload = {
            "name": "幂等人工版本",
            "layout": {k: v for k, v in data.items() if k in Layout.model_fields},
            "furniture": {"items": data.get("furniture", []), "notes": []},
        }
        edit_headers = {"Idempotency-Key": "test-request-edit-001"}
        path = f"/api/jobs/{job['id']}/edit"
        edit = client.post(path, json=payload, headers=edit_headers)
        repeated = client.post(path, json=payload, headers=edit_headers)
        assert edit.status_code == 201, edit.text
        assert repeated.json()["id"] == edit.json()["id"]
        payload["name"] = "不同的请求"
        assert client.post(path, json=payload, headers=edit_headers).status_code == 409


def test_glb_import_unit_thumbnail_and_sample_copy(tmp_path):
    model = trimesh.creation.box(extents=[100, 80, 60]).export(file_type="glb")
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        response = client.post(
            "/api/library/import",
            files={"file": ("桌子.glb", model, "model/gltf-binary")},
            data={"unit": "cm", "rotation": "90"},
        )
        assert response.status_code == 201, response.text
        item = next(
            i
            for i in client.get("/api/library/assets").json()["items"]
            if i["source"] == "imported"
        )
        assert np.allclose(item["dimensions"], [0.6, 1, 0.8])
        assert client.get(item["thumbnail_url"]).content.startswith(b"\x89PNG")
        sample = client.post("/api/projects/sample")
        assert sample.status_code == 201, sample.text
        assert sample.json()["status"] == "succeeded"
        assert sample.json()["result"]["room_count"] == 7


def test_wall_regions_reject_overlap_and_out_of_bounds():
    from backend.app.schemas import Wall
    from pydantic import ValidationError
    import pytest

    wall = layout_data()["walls"][0]
    region = dict(
        side="left", offset=0, width=1, bottom=0, height=1, material="wall-oak"
    )
    assert Wall.model_validate(dict(wall, finish_regions=[region])).finish_regions
    with pytest.raises(ValidationError):
        Wall.model_validate(dict(wall, finish_regions=[region, region]))
    with pytest.raises(ValidationError):
        Wall.model_validate(dict(wall, finish_regions=[dict(region, bottom=4)]))


def test_custom_wall_floor_texture_is_embedded_in_glb(tmp_path):
    from PIL import Image

    output = io.BytesIO()
    Image.new("RGB", (64, 64), "#c9bca1").save(output, format="PNG")
    app = app_for(tmp_path, FakeCodex())
    with TestClient(app) as client:
        response = client.post(
            "/api/materials/custom",
            files={"file": ("oak.png", output.getvalue(), "image/png")},
            data={"name": "用户木饰面"},
        )
        assert response.status_code == 201, response.text
        identifier = response.json()["id"]
        assert (
            client.get("/api/materials/custom").json()["items"][0]["name"]
            == "用户木饰面"
        )
        data = layout_data()
        data["rooms"][0]["floor_material"] = identifier
        data["walls"][0]["material_left"] = identifier
        data = Layout.model_validate(data).model_dump()
        data.update(style="natural", furniture_mode="basic", furniture=[])
        folder = tmp_path / "texture-export"
        folder.mkdir()
        Builder(
            data, Settings().furniture_catalog, app.state.settings.data_dir / "library"
        ).build(folder)
        scene = trimesh.load(folder / "model.glb", force="scene")
        assert any(
            identifier in m.visual.material.name
            and m.visual.material.baseColorTexture is not None
            for m in scene.geometry.values()
        )
