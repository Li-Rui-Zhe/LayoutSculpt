import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from backend.app.ai_contracts import (
    LayoutExtraction,
    apply_review_patch,
    pack_layout,
    unpack_layout,
)
from backend.app.ai_failures import ai_failure_message, classify_ai_error
from backend.app.ai_requests import (
    asset_input,
    furnishing_schema,
    layout_input,
    review_schema,
)
from backend.app.codex import CodexClient, CodexError, strict_output_schema
from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.recognition_contract import RecognitionContract
from backend.app.resilience import transient_ai_error
from backend.app.schemas import CustomStyleFurnishing, Furnishing
from backend.tests.test_ai_pipeline import canonical_layout, patch_for
from backend.tests.test_workflow import FakeCodex, create_job, fake_builder, wait_job


def test_compact_input_roundtrip_and_all_assets_remain_available():
    layout = canonical_layout()
    layout.rooms[0].floor_rotation = 32
    layout.rooms[0].edit_locked = True
    assert unpack_layout(layout_input(layout)) == layout
    items = [
        {
            "asset_id": "file:one",
            "name": "椅子",
            "kind": "chair",
            "dimensions": [1, 1, 1],
            "variant": "软包",
            "version": "unused",
        },
        {
            "asset_id": "diy:two",
            "name": "定制柜",
            "kind": "model",
            "dimensions": [1, 1, 1],
        },
    ]
    assert [i["asset_id"] for i in asset_input(items)] == [i["asset_id"] for i in items]
    assert asset_input(items)[0]["variant"] == "软包"


@pytest.mark.parametrize("model", [Furnishing, CustomStyleFurnishing])
def test_furnishing_request_excludes_edit_state_and_keeps_catalog_diy_selection(model):
    schema = strict_output_schema(furnishing_schema(model, library=True))
    fields = schema["$defs"]["Furniture"]["properties"]
    assert "diy" not in fields and "edit_locked" not in fields
    assert "model" in fields["kind"]["enum"] and "asset_id" in fields
    assert "DiyPart" not in schema["$defs"]
    assert (
        "diy"
        in furnishing_schema(model, library=False)["$defs"]["Furniture"]["properties"]
    )
    assert "diy" in model.model_json_schema()["$defs"]["Furniture"]["properties"]


def test_review_geometry_changes_preserve_manual_surface_and_edit_properties():
    layout = canonical_layout()
    layout.rooms[0].floor_rotation = 31
    layout.rooms[0].edit_locked = True
    # 用实际目录中的默认墙面，避免把不存在的编号混入回归数据。
    from backend.app.surface_materials import WALL_MATERIALS

    layout.walls[0].material_left = WALL_MATERIALS[0]
    layout.walls[0].load_bearing = True
    wire = pack_layout(layout)
    allowed = review_schema()["$defs"]["RoomWire"]["properties"]
    room = {k: v for k, v in wire["rooms"][0].items() if k in allowed}
    room["name"] = "新的房间名称"
    patch = patch_for(
        layout,
        rooms=[
            {
                "action": "update",
                "id": room["id"],
                "value": room,
                "evidence": "原图名称",
            }
        ],
        walls=[
            {
                "action": "update",
                "id": wire["walls"][0]["id"],
                "value": wire["walls"][0],
                "evidence": "原图墙高",
            }
        ],
    )
    result = apply_review_patch(layout, patch)
    assert result.rooms[0].name == "新的房间名称"
    assert result.rooms[0].floor_rotation == 31 and result.rooms[0].edit_locked
    assert result.walls[0].material_left == layout.walls[0].material_left
    assert result.walls[0].load_bearing


def test_custom_style_schema_uses_complete_current_catalog_including_diy_materials():
    custom_id = "texture:" + "a" * 64
    catalog = {
        "walls": [{"id": "wall-matte"}, {"id": custom_id}],
        "floor": [{"id": "floor-oak"}],
    }
    schema = furnishing_schema(
        CustomStyleFurnishing, library=True, surface_catalog=catalog
    )
    assert schema["properties"]["wall_material"] == {
        "type": "string",
        "enum": ["wall-matte", custom_id],
    }
    assert schema["properties"]["floor_material"] == {
        "type": "string",
        "enum": ["floor-oak"],
    }


class CompactCodex(FakeCodex):
    async def generate(self, **kwargs):
        output = await super().generate(**kwargs)
        if kwargs["schema"]["title"] == "LayoutExtraction":
            wire = json.loads(output)
            schema = RecognitionContract.model_json_schema()
            wire = {
                key: value for key, value in wire.items() if key in schema["properties"]
            }
            for collection, definition in [
                ("rooms", "RecognitionRoom"),
                ("openings", "RecognitionOpening"),
            ]:
                allowed = schema["$defs"][definition]["properties"]
                wire[collection] = [
                    {key: value for key, value in item.items() if key in allowed}
                    for item in wire[collection]
                ]
            RecognitionContract.model_validate(wire)
            unpack_layout(wire)
            return json.dumps(wire)
        return output


def test_compact_recognition_flows_through_parser_review_and_build(tmp_path):
    codex = CompactCodex()
    with TestClient(
        create_app(
            replace(Settings(), data_dir=tmp_path, ai_cache_enabled=False),
            client=codex,
            model_builder=fake_builder,
        )
    ) as client:
        final = wait_job(client, create_job(client)["id"])
        assert final["status"] == "succeeded", final
        schema = codex.calls[0]["schema"]
        assert "floor_tile_width" not in str(schema)
        assert "edit_locked" not in str(schema)
        assert "floor_finish" in str(schema)
        assert (
            len(json.dumps(strict_output_schema(schema)))
            < len(
                json.dumps(strict_output_schema(LayoutExtraction.model_json_schema()))
            )
            * 0.65
        )
        assert final["result"]["consistency"]["source_reviewed"]


@pytest.mark.parametrize(
    "info,status,expected,retry",
    [
        ("unauthorized", None, "authentication", False),
        ("rateLimitExceeded", None, "rate_limited", True),
        ("usageLimitExceeded", None, "quota_exceeded", False),
        ("contextWindowExceeded", None, "context_exceeded", False),
        ("httpConnectionFailed", 403, "authentication", False),
        ("responseStreamDisconnected", 503, "service_unavailable", True),
    ],
)
def test_structured_failure_classification(info, status, expected, retry):
    detail = {
        "message": "upstream error https://private.example/sk-secret",
        "codexErrorInfo": {info: {"httpStatusCode": status}} if status else info,
    }
    error = CodexError(str(detail), detail=detail)
    assert classify_ai_error(error)["code"] == expected
    assert transient_ai_error(error) is retry
    assert "private" not in json.dumps(classify_ai_error(error))
    assert "sk-secret" not in ai_failure_message(error, "户型识别")


def test_empty_output_has_specific_diagnosis_and_bounded_retry(tmp_path):
    class EmptyCodex(FakeCodex):
        async def generate(self, **kwargs):
            await super().generate(**kwargs)
            raise CodexError(
                "stream disconnected: upstream terminated with incomplete empty response (0 tokens)"
            )

    codex = EmptyCodex()
    with TestClient(
        create_app(
            replace(Settings(), data_dir=tmp_path, ai_cache_enabled=False),
            client=codex,
            model_builder=fake_builder,
        )
    ) as client:
        final = wait_job(client, create_job(client)["id"])
        assert final["status"] == "failed"
        assert "识别户型结构" in final["error"] and "未返回有效结果" in final["error"]
        assert "调整设计要求" not in final["error"]
        assert len(codex.calls) == 2
        metric = json.loads(
            (tmp_path / "jobs" / final["id"] / "pipeline-metrics.json").read_text(
                "utf-8"
            )
        )["stages"][0]
        assert metric["failure"] == {"code": "empty_response", "retryable": True}
        assert metric["requests"] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("recover", [True, False])
async def test_service_retry_notice_waits_for_terminal_result_and_keeps_details(
    tmp_path, recover
):
    client = CodexClient(Settings())
    events = []

    async def started():
        pass

    async def request(method, params, timeout=60):
        if method == "config/read":
            return {"config": {}}
        if method == "thread/start":
            return {"thread": {"id": "thread"}, "model": "chosen"}
        assert method == "turn/start"
        queue = client.threads["thread"]
        queue.put_nowait(
            {
                "method": "error",
                "params": {
                    "threadId": "thread",
                    "turnId": "turn",
                    "willRetry": recover,
                    "error": {
                        "message": "hidden https://private.example",
                        "codexErrorInfo": "rateLimitExceeded",
                    },
                },
            }
        )
        queue.put_nowait(
            {
                "method": "turn/completed",
                "params": {
                    "threadId": "thread",
                    "turn": {"id": "stale-turn", "status": "failed"},
                },
            }
        )
        if recover:
            queue.put_nowait(
                {
                    "method": "item/completed",
                    "params": {
                        "threadId": "thread",
                        "turnId": "turn",
                        "item": {
                            "id": "result",
                            "type": "agentMessage",
                            "text": '{"ok":true}',
                        },
                    },
                }
            )
        queue.put_nowait(
            {
                "method": "turn/completed",
                "params": {
                    "threadId": "thread",
                    "turn": {
                        "id": "turn",
                        "status": "completed" if recover else "failed",
                    },
                },
            }
        )
        return {"turn": {"id": "turn"}}

    async def event(value):
        events.append(value)

    client.ensure_started = started
    client.request = request
    call = client.generate(
        workspace=tmp_path,
        image=None,
        prompt="test",
        instructions="test",
        schema={},
        model="chosen",
        on_event=event,
    )
    if recover:
        assert await call == '{"ok":true}'
    else:
        with pytest.raises(CodexError) as caught:
            await call
        assert classify_ai_error(caught.value)["code"] == "rate_limited"
    assert events[-1]["type"] == "service_error"
    assert events[-1]["code"] == "rate_limited"
    assert "private" not in str(events)
    assert not client.threads
