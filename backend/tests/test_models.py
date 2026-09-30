import asyncio
from dataclasses import replace

import pytest

from backend.app.codex import CodexClient
from backend.app.config import Settings


@pytest.mark.asyncio
async def test_catalog_uses_all_pages_local_default_and_safe_fields():
    client = CodexClient(replace(Settings(), codex_model=None))
    calls = []

    async def started():
        pass

    async def request(method, params):
        calls.append((method, params))
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
    assert len(calls) == 3
    await client.list_models(refresh=True)
    assert len(calls) == 6


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
