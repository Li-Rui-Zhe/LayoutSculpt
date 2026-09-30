"""使用配置好的本地 Blender 离线构建家具资产，平时生成户型不需要运行。"""

from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.config import Settings, ROOT

if __name__ == "__main__":
    settings = Settings()
    if not settings.blender_path:
        raise SystemExit("未找到本地 Blender，请设置 .env 中的 BLENDER_PATH")
    raise SystemExit(
        subprocess.call(
            [
                settings.blender_path,
                "--background",
                "--factory-startup",
                "--disable-autoexec",
                "--python-exit-code",
                "1",
                "--python",
                str(ROOT / "tools/build_asset_library.py"),
            ]
        )
    )
