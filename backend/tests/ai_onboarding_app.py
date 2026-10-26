"""Isolated UI acceptance fixture. Run explicitly; never loaded in production."""

from dataclasses import replace
import tempfile
from pathlib import Path

import httpx

from backend.app.config import Settings, ROOT
from backend.app.main import create_app
from backend.tests.test_workflow import FakeCodex, fake_builder


temporary = tempfile.TemporaryDirectory(prefix="ai-onboarding-", dir=ROOT / "data" / "review")
app = create_app(replace(Settings(), data_dir=Path(temporary.name), frontend_port=8012),
                 client=FakeCodex(), model_builder=fake_builder)


async def models(request):
    if request.headers.get("authorization") != "Bearer layoutsculpt-test-key":
        return httpx.Response(401, json={"error":"Invalid key"})
    return httpx.Response(200, json={"data":[{"id":"acceptance-text", "name":"文字模型（验收）", "input_modalities":["text"]}]})


app.state.ai_client.remote.transport = httpx.MockTransport(models)
