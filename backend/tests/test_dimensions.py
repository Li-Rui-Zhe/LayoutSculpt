import pytest
from backend.app.schemas import Layout, Furniture, Furnishing, DimensionBasis
from backend.app.ai_contracts import pack_layout
from backend.app.ai_requests import furnishing_schema
from backend.app.dimension_status import dimension_label, furniture_size_label
from backend.app.quality import prepare_generated_furnishing
from backend.tests.test_workflow import layout_data
from backend.tests.test_workspace import workspace_client


def furniture():
    return Furniture(
        name="我的沙发",
        kind="sofa",
        room_id="living",
        x=3,
        y=3,
        width=2,
        depth=0.8,
        height=0.9,
        rotation=0,
        size_reference={"source": "product", "width": 2, "depth": 0.8, "height": 0.9},
    )


def test_dimensions_survive_schema_and_draft_reload(tmp_path):
    data = layout_data()
    wall = data["walls"][0]
    import math

    length = math.hypot(
        wall["end"]["x"] - wall["start"]["x"], wall["end"]["y"] - wall["start"]["y"]
    )
    data["dimension_basis"] = {
        "source": "user_reference",
        "anchors": [{"wall_id": wall["id"], "meters": length, "source": "measured"}],
    }
    layout = Layout.model_validate(data)
    document = {
        "layout": layout.model_dump(),
        "furniture": {"items": [furniture().model_dump()], "notes": []},
    }
    client, _ = workspace_client(tmp_path)
    path = "/api/drafts/edit:" + "a" * 32
    assert (
        client.post(path, json={"revision": 0, "document": document}).status_code == 200
    )
    other, _ = workspace_client(tmp_path)
    assert other.get(path).json()["document"] == document
    assert "参考长度校准" in dimension_label(document["layout"])
    document["layout"]["walls"] = []
    assert "重新校准" in dimension_label(document["layout"])
    assert "dimension_basis" not in pack_layout(layout)


def test_ai_cannot_turn_generated_size_into_user_confirmation():
    schema = furnishing_schema(Furnishing, library=True)
    assert "size_reference" not in schema["$defs"]["Furniture"]["properties"]
    plan = prepare_generated_furnishing(
        Furnishing(items=[furniture()], notes=[]), Layout.model_validate(layout_data())
    )
    assert all(item.size_reference is None for item in plan.items)


def test_modified_size_is_not_reported_as_original_product_size():
    item = furniture().model_dump()
    assert "商品尺寸" in furniture_size_label(item)
    item["depth"] = 1
    assert "重新核对" in furniture_size_label(item)
    with pytest.raises(ValueError):
        DimensionBasis(source="user_reference", anchors=[])
    with pytest.raises(ValueError):
        Furniture.model_validate(
            {
                **item,
                "size_reference": {
                    "source": "measured",
                    "width": float("nan"),
                    "depth": 1,
                    "height": 1,
                },
            }
        )


def test_product_reference_survives_personal_library_and_report(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.app.furniture_presets import install_furniture_presets
    from backend.app.deliverables import report_html
    from backend.tests.test_design_improvements import setup_store, Library

    app = FastAPI()
    install_furniture_presets(app, setup_store(tmp_path), Library())
    item = furniture().model_dump()
    with TestClient(app) as client:
        response = client.post("/api/furniture-presets", json=item)
        assert response.status_code == 201, response.text
    reopened = FastAPI()
    install_furniture_presets(reopened, setup_store(tmp_path), Library())
    with TestClient(reopened) as client:
        saved = client.get("/api/furniture-presets").json()["items"][0]["item"]
        assert saved["size_reference"] == item["size_reference"]
    data = {**layout_data(), "furniture": [item], "dimension_basis": {"source": "estimated"}}
    job = {"name": "尺寸验收", "id": "test", "created_at": "2026-11-05"}
    output = report_html(job, data)
    assert "尺寸估算，尚未校准" in output
    assert "用户录入商品尺寸" in output
    assert "模型无碰撞不代表现场一定放得下" in output
    item["width"] += 0.1
    assert "尺寸已改动，请重新核对" in report_html(job, data)
