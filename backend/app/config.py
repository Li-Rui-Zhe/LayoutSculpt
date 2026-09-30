"""项目配置。读取本项目 .env，继承本机 Codex 的登录信息，不复制凭据。"""

from dataclasses import dataclass, field
from pathlib import Path
import os
import shutil

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


def find_blender() -> str:
    configured = os.getenv("BLENDER_PATH")
    if configured:
        return configured
    installed = shutil.which("blender")
    if installed:
        return installed
    # Windows 官方安装程序默认不写入 PATH。
    if os.name == "nt":
        candidates = list(
            (
                Path(os.environ.get("ProgramFiles", "C:/Program Files"))
                / "Blender Foundation"
            ).glob("Blender */blender.exe")
        )
        if candidates:
            import re

            return str(
                max(
                    candidates,
                    key=lambda p: tuple(
                        int(v) for v in re.findall(r"\d+", p.parent.name)
                    ),
                )
            )
    return next(
        (str(p) for p in (ROOT / "tools" / "blender").glob("*/blender.exe")), ""
    )


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("STUDIO_DATA_DIR", ROOT / "data")
        ).resolve()
    )
    skills_dir: Path = ROOT / "skills"
    codex_command: str = field(
        default_factory=lambda: (
            os.getenv("CODEX_CMD")
            or shutil.which("codex.exe")
            or shutil.which("codex")
            or "codex"
        )
    )
    codex_model: str | None = field(
        default_factory=lambda: os.getenv("CODEX_MODEL") or None
    )
    codex_effort: str = field(
        default_factory=lambda: os.getenv("CODEX_EFFORT", "medium")
    )
    codex_timeout: int = field(
        default_factory=lambda: int(os.getenv("CODEX_TIMEOUT_SECONDS", "600"))
    )
    blender_path: str = field(default_factory=find_blender)
    furniture_catalog: Path = ROOT / "assets" / "furniture" / "catalog.json"
    blender_timeout: int = field(
        default_factory=lambda: int(os.getenv("BLENDER_TIMEOUT_SECONDS", "180"))
    )
    concurrency: int = field(
        default_factory=lambda: max(1, int(os.getenv("JOB_CONCURRENCY", "2")))
    )
    max_upload_bytes: int = 20 * 1024 * 1024

    @property
    def db_path(self) -> Path:
        return self.data_dir / "studio.sqlite3"

    def workspace(self, job_id: str) -> Path:
        return self.data_dir / "jobs" / job_id
