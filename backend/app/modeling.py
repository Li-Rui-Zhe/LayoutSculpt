"""Run the GLB builder in an isolated Python process for cancellable jobs."""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

from .config import ROOT, Settings
from .schemas import Furnishing, Layout
from .consistency import verify_export


async def build_model(
    settings: Settings,
    workspace: Path,
    layout: Layout,
    furniture: Furnishing,
    style: str,
    furniture_mode: str = "library",
):
    document = {
        **layout.model_dump(),
        "furniture": furniture.model_dump()["items"],
        "style": style,
        "furniture_notes": furniture.notes,
        "furniture_mode": furniture_mode,
    }
    path = workspace / "layout.json"
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    args = [
        sys.executable,
        "-m", "backend.app.glb_builder",
        "--layout", str(path),
        "--output", str(workspace),
        "--asset-catalog", str(settings.furniture_catalog),
    ]
    with (workspace / "modeling.log").open("wb") as log:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=log,
            stderr=asyncio.subprocess.STDOUT,
            cwd=ROOT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        try:
            code = await asyncio.wait_for(process.wait(), settings.model_timeout)
            if code != 0:
                raise RuntimeError("GLB 建模失败，请查看该任务的建模日志。")
        except BaseException:
            if process.returncode is None:
                process.kill()
                await process.wait()
            raise
    model = workspace / "model.glb"
    report = workspace / "furniture-report.json"
    if not model.is_file() or model.stat().st_size < 128 or not report.is_file():
        raise RuntimeError("建模程序未输出有效 GLB 或家具报告")
    result = json.loads(report.read_text(encoding="utf-8"))
    result["consistency"] = await asyncio.to_thread(verify_export, document, model)
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result
