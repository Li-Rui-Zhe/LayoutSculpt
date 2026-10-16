import json
from io import BytesIO
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.project_transfer import read_project_archive
from backend.app.schemas import JobOptions, Layout
from backend.tests.test_workflow import (
    FakeCodex,
    app_for,
    furniture_data,
    image_bytes,
    wait_job,
)

DESCRIPTION = "中古风，胡桃木搭配米白墙面，避免亮面金属"
SCHEME = {
    "render_style": "modern",
    "wall_material": "wall-lime",
    "floor_material": "floor-walnut",
}


class StyleCodex(FakeCodex):
    async def generate(self, **kwargs):
        if kwargs["schema"]["title"] == "CustomStyleFurnishing":
            self.calls.append(kwargs)
            return json.dumps({**furniture_data(), **SCHEME}, ensure_ascii=False)
        return await super().generate(**kwargs)


def test_style_options_compatibility():
    assert JobOptions().style == "natural"
    assert (
        JobOptions(style="cream", style_description=DESCRIPTION).style_description == ""
    )
    assert (
        JobOptions(
            style="custom", style_description=f" {DESCRIPTION} "
        ).style_description
        == DESCRIPTION
    )
    for value in ["", "  ", "风" * 1001]:
        with pytest.raises(ValidationError):
            JobOptions(style="custom", style_description=value)


@pytest.mark.parametrize("description", ["", "  ", "风" * 1001])
def test_invalid_custom_style_does_not_start_ai(tmp_path, description):
    codex = StyleCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        response = client.post(
            "/api/jobs",
            files={"file": ("plan.png", image_bytes(), "image/png")},
            data={"style": "custom", "style_description": description},
        )
        assert response.status_code == 422, response.text
        assert response.json()["detail"] == (
            "自定义风格描述最多填写 1000 个字符"
            if len(description) > 1000
            else "请填写自定义空间风格"
        )
        assert codex.calls == []


def test_invalid_style_returns_actionable_chinese_message(tmp_path):
    with TestClient(app_for(tmp_path, StyleCodex())) as client:
        response = client.post(
            "/api/jobs",
            files={"file": ("plan.png", image_bytes(), "image/png")},
            data={"style": "unknown"},
        )
        assert response.status_code == 422
        assert response.json()["detail"] == "空间风格选项无效，请重新选择"


@pytest.mark.parametrize("manual_materials", [False, True])
def test_custom_style_generation_and_saved_versions(tmp_path, manual_materials):
    codex = StyleCodex()
    with TestClient(app_for(tmp_path, codex)) as client:
        data = {
            "style": "custom",
            "style_description": DESCRIPTION,
            "collaboration": "false",
        }
        if manual_materials:
            data.update(wall_material="wall-oak", floor_material="floor-gray-tile")
        response = client.post(
            "/api/jobs",
            files={"file": ("plan.png", image_bytes(), "image/png")},
            data=data,
        )
        assert response.status_code == 201, response.text
        job = wait_job(client, response.json()["id"])
        assert job["status"] == "succeeded", job
        assert job["result"]["render_style"] == "modern"
        assert job["result"]["style_scheme"] == SCHEME
        call = next(
            c for c in codex.calls if c["schema"]["title"] == "CustomStyleFurnishing"
        )
        assert DESCRIPTION in call["prompt"]
        assert "surface_catalog" in call["prompt"]
        document = client.get(job["result"]["layout_url"]).json()
        assert document["style"] == "modern"
        assert document["style_choice"] == "custom"
        assert document["style_description"] == DESCRIPTION
        assert all(
            w["wall_material"] == data.get("wall_material", "wall-lime")
            for w in document["walls"]
        )
        assert document["rooms"][0]["floor_material"] == data.get(
            "floor_material", "floor-walnut"
        )

        # An effect rebuild must keep the same design without asking AI again.
        calls = len(codex.calls)
        response = client.post(f"/api/jobs/{job['id']}/rebuild")
        assert response.status_code == 201, response.text
        rebuilt = wait_job(client, response.json()["id"])
        assert rebuilt["status"] == "succeeded", rebuilt
        assert rebuilt["result"]["render_style"] == "modern"
        assert rebuilt["result"]["style_scheme"] == SCHEME
        assert len(codex.calls) == calls

        # Editing a single wall/floor must survive the original global selection.
        document["walls"][0]["wall_material"] = "wall-cement"
        document["rooms"][0]["floor_material"] = "floor-travertine"
        response = client.post(
            f"/api/jobs/{job['id']}/edit",
            json={
                "name": "人工设计版本",
                "layout": {
                    k: v for k, v in document.items() if k in Layout.model_fields
                },
                "furniture": {"items": document["furniture"], "notes": []},
            },
        )
        assert response.status_code == 201, response.text
        edited = wait_job(client, response.json()["id"])
        assert edited["status"] == "succeeded", edited
        saved = client.get(edited["result"]["layout_url"]).json()
        assert saved["walls"][0]["wall_material"] == "wall-cement"
        assert saved["rooms"][0]["floor_material"] == "floor-travertine"
        assert saved["style"] == "modern"
        assert saved["style_description"] == DESCRIPTION
        assert len(codex.calls) == calls

        # Imported projects keep the description and the effective renderer palette.
        archive = BytesIO()
        saved["furniture"] = []
        with ZipFile(archive, "w") as bundle:
            bundle.writestr("layout.json", json.dumps(saved))
            bundle.writestr("source.png", image_bytes())
        _, _, options, *_ = read_project_archive(archive.getvalue())
        assert options.style == "custom"
        assert options.style_description == DESCRIPTION
        assert options.render_style == "modern"
        response = client.post(
            "/api/projects/import",
            files={"file": ("project.zip", archive.getvalue(), "application/zip")},
        )
        assert response.status_code == 201, response.text
        imported = wait_job(client, response.json()["id"])
        assert imported["status"] == "succeeded", imported
        assert imported["result"]["render_style"] == "modern"
        assert imported["options"]["style_description"] == DESCRIPTION
        assert len(codex.calls) == calls, "恢复项目不能重新调用 AI"
        restored = client.get(imported["result"]["layout_url"]).json()
        assert restored["furniture"] == []
        assert restored["walls"] == saved["walls"]
        assert restored["rooms"] == saved["rooms"]
