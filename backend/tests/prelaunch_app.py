"""Isolated browser acceptance server; never uses the user's job database."""
import os
import asyncio
from dataclasses import replace
from pathlib import Path

from backend.app import main
from backend.app.config import Settings, ROOT
from backend.tests.test_workflow import FakeCodex


class BrowserCodex(FakeCodex):
    async def generate(self, **kwargs):
        if kwargs["schema"]["title"] == "Furnishing":
            await asyncio.sleep(4)  # 留出可观测的真实初稿阶段，避免浏览器时序竞态。
        return await super().generate(**kwargs)

main.ALLOWED_ORIGINS.add(f"http://127.0.0.1:{int(os.getenv("STUDIO_TEST_PORT", "8011"))}")
app = main.create_app(
    replace(Settings(), data_dir=Path(os.getenv("STUDIO_TEST_DATA", str(ROOT / "data" / "prelaunch-browser")))),
    client=BrowserCodex(delay=0.15),
)
