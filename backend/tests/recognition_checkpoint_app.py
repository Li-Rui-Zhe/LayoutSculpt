"""Isolated browser fixture with two geometric recognition failures and real GLBs."""

import os
from dataclasses import replace
from pathlib import Path

from backend.app import main
from backend.app.config import ROOT, Settings
from backend.tests.test_recognition_checkpoint import InvalidGeometry

main.ALLOWED_ORIGINS.add(f"http://127.0.0.1:{int(os.getenv('STUDIO_TEST_PORT', '8011'))}")
app = main.create_app(
    replace(Settings(), data_dir=Path(os.getenv("STUDIO_TEST_DATA", str(ROOT / "data" / "recognition-checkpoint-browser")))),
    client=InvalidGeometry(),
)
