"""使用配置好的本地 Blender 离线构建家具资产，平时生成户型不需要运行。"""

import os
import re
import shutil
import subprocess
import sys
import ast
import json
import tempfile
import time
import hashlib
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
    def run(script, *arguments):
        code = subprocess.call([blender, "--background", "--factory-startup", "--disable-autoexec",
            "--python-exit-code", "1", "--python", str(script), "--", *arguments])
        if code:
            raise SystemExit(code)

    kinds = []
    for filename in ["tools/build_asset_library.py", "tools/asset_expansion.py"]:
        tree = ast.parse((ROOT / filename).read_text(encoding="utf-8"))
        for statement in tree.body:
            if isinstance(statement, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "SPECS" for t in statement.targets):
                kinds.extend(key.value for key in statement.value.keys if isinstance(key, ast.Constant))
    with tempfile.TemporaryDirectory(prefix="layoutsculpt-assets-") as staging:
        for kind in kinds:
            output = Path(staging) / kind
            run(ROOT / "tools/build_asset_library.py", f"--asset={kind}", f"--output={output}")
            if not (output / "catalog.json").is_file() or not (output / "habitat-furniture.blend").is_file():
                raise SystemExit(f"Blender 未完成素材制作：{kind}")
        merged_at = time.time_ns()
        run(ROOT / "scripts/merge_asset_library.py", staging)
    catalog = json.loads((ROOT / "assets/furniture/catalog.json").read_text(encoding="utf-8"))
    if {entry["kind"] for entry in catalog["items"]} != set(kinds):
        raise SystemExit("素材目录不完整，停止导出")
    library = ROOT / "assets/furniture" / catalog["library"]
    if library.stat().st_mtime_ns < merged_at or hashlib.sha256(library.read_bytes()).hexdigest() != catalog["sha256"]:
        raise SystemExit("Blender 未完成源工程合并，停止导出")
    from backend.app.library_models import load_glb
    for kind in kinds:
        started = time.time_ns()
        run(ROOT / "scripts/export_furniture_glb.py", f"--asset={kind}")
        output = ROOT / "assets/furniture/glb" / f"{kind}.glb"
        if not output.is_file() or output.stat().st_mtime_ns < started:
            raise SystemExit(f"Blender 未完成产物：{output.name}")
        load_glb(output.read_bytes())
    subprocess.run([sys.executable, str(ROOT / "scripts/render_asset_thumbnails.py")], check=True)
    subprocess.run([sys.executable, str(ROOT / "scripts/build_extra_assets.py")], check=True)
    raise SystemExit(subprocess.call([sys.executable, str(ROOT / "scripts/build_home_collection.py")]))
