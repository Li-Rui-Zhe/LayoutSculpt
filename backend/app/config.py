"""项目配置。读取本项目 .env，继承本机 Codex 的登录信息，不复制凭据。"""

import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


def find_codex_command():
    if os.getenv("CODEX_CMD"):
        return os.environ["CODEX_CMD"]
    found = shutil.which("codex.exe") or shutil.which("codex")
    if found:
        return found
    # GUI-launched processes on macOS may not inherit the terminal's PATH.
    for candidate in (
        Path("/opt/homebrew/bin/codex"),
        Path("/usr/local/bin/codex"),
        Path.home() / ".local/bin/codex",
        Path.home() / ".npm-global/bin/codex",
    ):
        if candidate.is_file():
            return str(candidate)
    return "codex"


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("STUDIO_DATA_DIR", ROOT / "data")
        ).resolve()
    )
    skills_dir: Path = ROOT / "skills"
    codex_command: str = field(default_factory=find_codex_command)
    codex_model: str | None = field(
        default_factory=lambda: os.getenv("CODEX_MODEL") or None
    )
    codex_effort: str = field(
        default_factory=lambda: os.getenv("CODEX_EFFORT", "medium")
    )
    codex_timeout: int = field(
        default_factory=lambda: int(os.getenv("CODEX_TIMEOUT_SECONDS", "600"))
    )
    review_timeout: float = field(
        default_factory=lambda: max(
            1, float(os.getenv("AI_REVIEW_TIMEOUT_SECONDS", "300"))
        )
    )
    ai_cache_enabled: bool = field(
        default_factory=lambda: (
            os.getenv("AI_CACHE_ENABLED", "true").lower() in {"1", "true", "yes"}
        )
    )
    furniture_catalog: Path = ROOT / "assets" / "furniture" / "catalog.json"
    model_timeout: int = field(
        default_factory=lambda: int(os.getenv("MODEL_TIMEOUT_SECONDS", "180"))
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
