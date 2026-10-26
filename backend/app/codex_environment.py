"""Project-owned Codex configuration; legacy installations keep their opt-in mode."""

import os
import csv
import subprocess
from pathlib import Path

from .network import codex_environment
from .toolchain_paths import read_active


def environment_mode(settings):
    entry = read_active(settings.data_dir).get("codex", {})
    return "isolated" if entry.get("config_mode") == "isolated" else "shared"


def isolated_home(settings):
    return Path(settings.data_dir).resolve() / "runtime" / "codex-home"


def private_directory(directory):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name != "nt":
        directory.chmod(0o700)
        return
    # The CLI's auth file is scoped to this directory and inherits this ACL.
    result = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True,
                            text=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW, check=True)
    sid = next(csv.reader(result.stdout.strip().splitlines()))[-1]
    if not sid.startswith("S-1-"):
        raise OSError("无法确认当前账户，未创建独立登录环境。")
    subprocess.run(["icacls", str(directory), "/inheritance:r", "/grant:r", f"*{sid}:(OI)(CI)F"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5,
                   creationflags=subprocess.CREATE_NO_WINDOW, check=True)


def child_environment(settings, mode, *, home=None):
    env = codex_environment()
    if mode != "isolated":
        return env
    # Preserve OS/network essentials; remove inherited AI credentials/configuration.
    for key in list(env):
        if key.upper().startswith(("CODEX_", "OPENAI_", "CHATGPT_", "ANTHROPIC_")):
            env.pop(key)
    directory = Path(home) if home else isolated_home(settings)
    private_directory(directory)
    env["CODEX_HOME"] = str(directory)
    return env


def isolated_args(mode):
    if mode != "isolated":
        return []
    # File credentials live in this CODEX_HOME, never the shared OS credential slot.
    return ["-c", 'cli_auth_credentials_store="file"', "-c", "project_doc_max_bytes=0"]
