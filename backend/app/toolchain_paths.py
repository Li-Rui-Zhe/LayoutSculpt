"""Validated pointers to this project's privately installed runtimes."""

import json
from pathlib import Path

_DEFAULT = object()


def runtime_root(data_dir):
    return Path(data_dir).resolve() / "runtime"


def read_active(data_dir):
    root = runtime_root(data_dir)
    try:
        data = json.loads((root / "active.json").read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
        return {
            name: entry
            for name, entry in data.items()
            if name == "codex" and isinstance(entry, dict)
        }
    except (OSError, ValueError, TypeError):
        return {}


def selected_tool(data_dir, name, *, entry=_DEFAULT):
    root = runtime_root(data_dir)
    entry = read_active(data_dir).get(name) if entry is _DEFAULT else entry
    if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
        return None
    path = (root / entry["path"]).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        return None
    expected = {"codex": {"codex", "codex.exe"}}[name]
    return str(path) if path.name in expected else None


def architecture_label(value):
    return {
        "amd64": "x64（64 位）",
        "x86_64": "x64（64 位）",
        "arm64": "ARM64",
        "aarch64": "ARM64",
        "x86": "x86（32 位）",
    }.get(value.lower(), value)
