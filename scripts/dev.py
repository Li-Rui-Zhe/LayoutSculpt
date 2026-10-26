"""Compatibility entry for starting the development servers."""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

if __name__ == "__main__":
    local_python = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    python = str(local_python) if local_python.exists() else sys.executable
    raise SystemExit(subprocess.call([python, str(ROOT / "scripts/startup.py"), "all", *sys.argv[1:]], cwd=ROOT))
