import asyncio
import json
import os
from pathlib import Path
import subprocess

from .config import ROOT, Settings
from .schemas import Layout, Furnishing


async def build_model(
    settings: Settings,
    workspace: Path,
    layout: Layout,
    furniture: Furnishing,
    style: str,
    furniture_mode: str = "library",
):
    if not settings.blender_path or not Path(settings.blender_path).is_file():
        raise RuntimeError(
            "未找到 Blender，请在项目 .env 中配置 BLENDER_PATH，然后重试。"
        )
    document = {
        **layout.model_dump(),
        "furniture": furniture.model_dump()["items"],
        "style": style,
        "furniture_notes": furniture.notes,
        "furniture_mode": furniture_mode,
    }
    path = workspace / "layout.json"
    path.write_text(
        json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    args = [
        settings.blender_path,
        "--background",
        "--factory-startup",
        "--disable-autoexec",
        "--python-exit-code",
        "1",
        "--python",
        str(ROOT / "tools" / "build_from_layout.py"),
        "--",
        "--layout",
        str(path),
        "--output",
        str(workspace),
        "--asset-catalog",
        str(settings.furniture_catalog),
    ]
    with (workspace / "blender.log").open("wb") as log:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=log,
            stderr=asyncio.subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        try:
            code = await asyncio.wait_for(process.wait(), settings.blender_timeout)
            if code != 0:
                raise RuntimeError("Blender 建模失败，请查看该任务的建模日志。")
        except BaseException:
            if process.returncode is None:
                process.kill()
                await process.wait()
            raise
    model = workspace / "model.glb"
    if not model.exists() or model.stat().st_size < 128:
        raise RuntimeError("Blender 未输出有效模型")
    if (
        not (workspace / "model.blend").is_file()
        or not (workspace / "furniture-report.json").is_file()
    ):
        raise RuntimeError("Blender 工程或家具构建记录缺失")
    return json.loads((workspace / "furniture-report.json").read_text(encoding="utf-8"))
