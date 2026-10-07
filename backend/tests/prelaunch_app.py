"""Isolated browser acceptance server; never uses the user's job database."""
from dataclasses import replace
from pathlib import Path

from backend.app import main
from backend.app.config import Settings, ROOT
from backend.tests.test_workflow import FakeCodex

main.ALLOWED_ORIGINS.add("http://127.0.0.1:8011")
app = main.create_app(
    replace(Settings(), data_dir=Path(ROOT / "data" / "prelaunch-browser")),
    client=FakeCodex(delay=0.15),
)
