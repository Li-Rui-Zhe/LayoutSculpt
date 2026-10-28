"""Isolated source-overlay fixture; no user data or external AI calls."""
import os
from dataclasses import replace
from pathlib import Path

from backend.app import main
from backend.app.config import ROOT, Settings
from backend.tests.test_source_evidence import PreciseReader

main.ALLOWED_ORIGINS.add(f"http://127.0.0.1:{int(os.getenv('STUDIO_TEST_PORT', '8011'))}")
reader = PreciseReader()
reader.wrong_audit = True
app = main.create_app(
    replace(Settings(), data_dir=Path(os.getenv("STUDIO_TEST_DATA", str(ROOT / "data" / "source-evidence-browser")))),
    client=reader,
)
