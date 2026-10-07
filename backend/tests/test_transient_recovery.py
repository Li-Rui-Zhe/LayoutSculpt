import pytest
from dataclasses import replace
from fastapi.testclient import TestClient

from backend.app.codex import CodexError
from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.resilience import transient_ai_error
from backend.tests.test_workflow import FakeCodex, create_job, fake_builder, wait_job


@pytest.mark.parametrize("message,expected", [
    ("本地 Codex 服务意外退出，请重试", True),
    ("HTTP 503 temporarily unavailable", True),
    ("connection reset by peer", True),
    ("HTTP 429 rate_limit", True),
    ("HTTP 401 unauthorized", False),
    ("model not supported", False),
    ("Invalid schema for response_format", False),
    ("原图在处理期间发生变化", False),
    ("所选模型不一致", False),
])
def test_only_temporary_transport_failures_are_retryable(message, expected):
    assert transient_ai_error(CodexError(message)) is expected


class ConnectionCodex(FakeCodex):
    def __init__(self, stage="LayoutExtraction", *, permanent=False, persistent=False, timeout=False):
        super().__init__()
        self.stage = stage
        self.failures = 0
        self.permanent = permanent
        self.persistent = persistent
        self.timeout = timeout

    async def generate(self, **kwargs):
        output = await super().generate(**kwargs)
        if kwargs["schema"]["title"] == self.stage and (not self.failures or self.persistent):
            self.failures += 1
            if self.timeout:
                raise TimeoutError("模拟请求握手超时")
            raise CodexError("model not supported" if self.permanent else "HTTP 503 temporarily unavailable")
        return output


@pytest.mark.parametrize("timeout", [False, True])
def test_recognition_reconnects_once_without_changing_model(tmp_path, timeout):
    settings = replace(Settings(), data_dir=tmp_path, ai_cache_enabled=False)
    codex = ConnectionCodex(timeout=timeout)
    with TestClient(create_app(settings, client=codex, model_builder=fake_builder)) as client:
        final = wait_job(client, create_job(client)["id"])
        assert final["status"] == "succeeded", final
        assert codex.failures == 1
        assert [call["schema"]["title"] for call in codex.calls] == ["LayoutExtraction", "LayoutExtraction", "LayoutReviewPatch", "Furnishing"]
        assert all(call["model"] == "test-default" for call in codex.calls)
        stages = final["result"]["pipeline_metrics"]["stages"]
        assert stages[0]["connection_retries"] == 1


def test_persistent_disconnect_has_a_limit_and_auth_or_model_errors_are_not_retried(tmp_path):
    for permanent, count in [(False, 2), (True, 1)]:
        settings = replace(Settings(), data_dir=tmp_path / str(permanent), ai_cache_enabled=False)
        codex = ConnectionCodex(permanent=permanent, persistent=True)
        with TestClient(create_app(settings, client=codex, model_builder=fake_builder)) as client:
            final = wait_job(client, create_job(client)["id"])
            assert final["status"] == "failed"
            assert len(codex.calls) == count


@pytest.mark.parametrize("stage", ["LayoutReviewPatch", "Furnishing"])
def test_optional_stage_disconnect_keeps_confirmed_house_deliverable(tmp_path, stage):
    settings = replace(Settings(), data_dir=tmp_path, ai_cache_enabled=False)
    codex = ConnectionCodex(stage, persistent=True)
    with TestClient(create_app(settings, client=codex, model_builder=fake_builder)) as client:
        final = wait_job(client, create_job(client)["id"])
        assert final["status"] == "succeeded", final
        assert final["result"]["consistency"]["source_reviewed"]
        assert codex.failures == 2
        if stage == "LayoutReviewPatch":
            assert final["result"]["ai_review"]["status"] == "incomplete"
        else:
            assert final["result"]["delivery_status"] == "structure_ready"
            assert "家具尚未完成" in final["result"]["delivery_notice"]
