import asyncio
from dataclasses import replace

import pytest

from backend.app.codex import CodexClient, CodexError, codex_error_message, strict_output_schema
from backend.app.config import Settings
from backend.app.schemas import Furnishing, Layout
from backend.app.ai_contracts import LayoutExtraction, LayoutReviewPatch


@pytest.mark.parametrize("model", [Layout, Furnishing, LayoutExtraction, LayoutReviewPatch])
def test_pydantic_schema_is_compatible_with_strict_output(model):
    original = model.model_json_schema()
    schema = strict_output_schema(original)
    assert schema is not original

    def verify(value):
        if isinstance(value, list):
            for item in value:
                verify(item)
        elif isinstance(value, dict):
            assert "default" not in value
            if value.get("type") == "object" or "properties" in value:
                assert value["required"] == list(value.get("properties", {}))
                assert value["additionalProperties"] is False
            for item in value.values():
                verify(item)

    verify(schema)
    assert original != schema


@pytest.mark.asyncio
async def test_catalog_uses_all_pages_local_default_and_safe_fields():
    client = CodexClient(replace(Settings(), codex_model=None))
    calls = []

    async def started():
        pass

    async def request(method, params):
        calls.append((method, params))
        if method == "account/read":
            return {"account": {"type": "apiKey"}, "requiresOpenaiAuth": False}
        if method == "config/read":
            return {
                "config": {
                    "model": "custom-provider-model",
                    "api_key": "must-not-be-exposed",
                }
            }
        if not params["cursor"]:
            return {
                "data": [
                    {
                        "model": "vision",
                        "displayName": "Vision",
                        "inputModalities": ["text", "image"],
                        "isDefault": True,
                    }
                ],
                "nextCursor": "page-two",
            }
        return {
            "data": [{"model": "text", "inputModalities": ["text"]}],
            "nextCursor": None,
        }

    client.ensure_started = started
    client.request = request
    catalog = await client.list_models()
    assert catalog["default_model"] == "custom-provider-model"
    assert [m["id"] for m in catalog["items"]] == [
        "vision",
        "text",
        "custom-provider-model",
    ]
    assert catalog["items"][1]["supports_image"] is False
    assert catalog["items"][2]["source"] == "local_config"
    assert "must-not-be-exposed" not in str(catalog)
    await client.list_models()
    assert len(calls) == 4
    await client.list_models(refresh=True)
    assert len(calls) == 8


@pytest.mark.asyncio
@pytest.mark.parametrize("auth,requires_auth,available", [
    ("chatgpt", True, False), ("apiKey", True, True),
    ("chatgpt", False, True), (None, None, True),
])
async def test_configured_model_missing_from_catalog_respects_provider(auth, requires_auth, available):
    client = CodexClient(replace(Settings(), codex_model=None))
    async def started():
        pass
    async def request(method, params):
        if method == "config/read":
            return {"config": {"model": "new-model", "api_key": "do-not-expose"}}
        if method == "account/read":
            if auth is None:
                raise CodexError("method not found")
            return {"account": {"type": auth, "email": "private@example.test"}, "requiresOpenaiAuth": requires_auth}
        return {"data": [
            {"model": "text-default", "isDefault": True, "inputModalities": ["text"]},
            {"model": "vision", "inputModalities": ["image"],
             "supportedReasoningEfforts": [{"reasoningEffort": "high"}], "defaultReasoningEffort": "high"},
        ]}
    client.ensure_started = started
    client.request = request
    catalog = await client.list_models()
    assert catalog["items"][-1]["available"] is available
    assert catalog["default_model"] == ("new-model" if available else "vision")
    assert bool(catalog["notice"]) is not available
    assert catalog["items"][1]["efforts"] == ["high"]
    assert "private@example.test" not in str(catalog)
    assert "do-not-expose" not in str(catalog)


def test_unsupported_model_error_is_actionable():
    raw = {"message": '{"detail":"The \'gpt-6.1-sol\' model is not supported when using Codex with a ChatGPT account."}'}
    assert "当前本地 Codex 登录不支持模型「gpt-6.1-sol」" in codex_error_message(raw)
    assert codex_error_message("ordinary error") == "ordinary error"
    import json
    assert "不支持模型「gpt-6.1-sol」" in codex_error_message(json.dumps(raw))


@pytest.mark.asyncio
async def test_definite_rejection_disables_catalog_model_and_notifies_only_its_thread():
    client = CodexClient(replace(Settings(), codex_model="blocked"))
    blocked, other = asyncio.Queue(), asyncio.Queue()
    client.threads.update(blocked_thread=blocked, other_thread=other)
    client.thread_models.update(blocked_thread="blocked", other_thread="vision")
    client.record_model_rejection("The 'blocked' model is not supported when using Codex with a ChatGPT account.")
    assert (await blocked.get())["method"] == "client/modelRejected"
    assert other.empty()
    async def started():
        pass
    async def request(method, params):
        if method == "config/read":
            return {"config": {}}
        if method == "account/read":
            return {"account": {"type": "chatgpt"}, "requiresOpenaiAuth": True}
        return {"data": [
            {"model": "blocked", "isDefault": True}, {"model": "vision"},
        ]}
    client.ensure_started = started
    client.request = request
    catalog = await client.list_models(refresh=True)
    assert catalog["default_model"] == "vision"
    assert catalog["items"][0]["available"] is False
    assert "不支持模型「blocked」" in catalog["items"][0]["unavailable_reason"]


@pytest.mark.asyncio
async def test_each_codex_thread_receives_its_own_selected_model(tmp_path):
    client = CodexClient(replace(Settings(), codex_model="global-default"))
    starts, turns, events = [], [], []

    async def started():
        pass

    async def request(method, params, timeout=60):
        if method == "thread/start":
            starts.append(params)
            return {"thread": {"id": params["model"]}, "model": params["model"]}
        turns.append(params)
        tid = params["threadId"]
        queue = client.threads[tid]
        queue.put_nowait(
            {
                "method": "item/completed",
                "params": {
                    "threadId": tid,
                    "turnId": "turn",
                    "item": {
                        "id": "answer",
                        "type": "agentMessage",
                        "text": '{"ok":true}',
                    },
                },
            }
        )
        queue.put_nowait(
            {
                "method": "turn/completed",
                "params": {"threadId": tid, "turn": {"status": "completed"}},
            }
        )
        return {"turn": {"id": "turn"}}

    async def event(value):
        events.append(value)

    client.ensure_started = started
    client.request = request
    await asyncio.gather(
        *[
            client.generate(
                workspace=tmp_path,
                image=tmp_path / "source.png",
                prompt="识别",
                instructions="契约",
                schema={},
                model=model,
                reasoning_effort=effort,
                on_event=event,
            )
            for model, effort in [("selected-a", "low"), ("selected-b", "high")]
        ]
    )
    assert {p["model"] for p in starts} == {"selected-a", "selected-b"}
    assert {e["model"] for e in events} == {"selected-a", "selected-b"}
    assert {p["threadId"]: p["effort"] for p in turns} == {
        "selected-a": "low",
        "selected-b": "high",
    }
    assert client.settings.codex_model == "global-default"
    assert not client.threads
