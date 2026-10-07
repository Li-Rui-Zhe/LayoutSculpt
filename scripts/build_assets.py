"""使用配置好的本地 Blender 离线构建家具资产，平时生成户型不需要运行。"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.config import ROOT


def find_blender():
    configured = os.getenv("BLENDER_PATH")
    if configured:
        return configured
    installed = shutil.which("blender")
    if installed:
        return installed
    if os.name == "nt":
        candidates = list((Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Blender Foundation").glob("Blender */blender.exe"))
        if candidates:
            return str(max(candidates, key=lambda p: tuple(int(v) for v in re.findall(r"\d+", p.parent.name))))
    return next((str(p) for p in (ROOT / "tools" / "blender").glob("*/blender.exe")), "")

if __name__ == "__main__":
    blender = find_blender()
    if not blender:
        raise SystemExit("未找到本地 Blender，请设置 .env 中的 BLENDER_PATH")
    for script in [
        ROOT / "tools/build_asset_library.py",
        ROOT / "scripts/export_furniture_glb.py",
    ]:
        code = subprocess.call(
            [
                blender,
                "--background",
                "--factory-startup",
                "--disable-autoexec",
                "--python-exit-code",
                "1",
                "--python",
                str(script),
            ]
        )
        if code:
            raise SystemExit(code)
    raise SystemExit(subprocess.call([sys.executable, str(ROOT / "scripts/build_extra_assets.py")]))
