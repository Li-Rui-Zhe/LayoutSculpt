"""Content-addressed cache of complete, validated AI responses only."""

import asyncio
import hashlib
import json
import os
import time
from pathlib import Path
from uuid import uuid4
from weakref import WeakValueDictionary

from .store import now

PIPELINE_VERSION = "compact-structure-patch-v1"


def compact_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class StageCache:
    def __init__(self, root):
        self.root = Path(root)
        # 同一输入共享推理；不同输入不能因散列桶碰撞而互相阻塞。
        # 等待者和持有者释放后自动回收锁，避免按任务数量累积。
        self.locks = WeakValueDictionary()

    def prune(self, max_bytes=512 * 1024 * 1024, max_age_days=30):
        """Remove only rebuildable cache entries; never traverse directory links."""
        if not self.root.exists() or self.root.is_symlink() or (hasattr(self.root, "is_junction") and self.root.is_junction()):
            return {"removed_bytes": 0, "remaining_bytes": 0}
        entries = []
        for folder in self.root.iterdir():
            if not folder.is_dir() or folder.is_symlink() or (hasattr(folder, "is_junction") and folder.is_junction()):
                continue
            for path in folder.glob("*.json"):
                if path.is_symlink() or len(path.stem) != 64 or any(c not in "0123456789abcdef" for c in path.stem) or folder.name != path.stem[:2]:
                    continue
                try:
                    stat = path.stat()
                    entries.append((stat.st_mtime, stat.st_size, path))
                except FileNotFoundError:
                    pass
        entries.sort(reverse=True)
        kept = removed = 0
        cutoff = time.time() - max_age_days * 86400
        for modified, size, path in entries:
            if modified < cutoff or kept + size > max_bytes:
                try:
                    path.unlink()
                    removed += size
                except FileNotFoundError:
                    pass
            else:
                kept += size
        return {"removed_bytes": removed, "remaining_bytes": kept}

    def key(
        self,
        *,
        source_sha256,
        instructions,
        prompt,
        schema,
        model,
        effort,
        role,
        runtime=None,
    ):
        material = {
            "version": PIPELINE_VERSION,
            "source_sha256": source_sha256,
            "instructions": instructions,
            "prompt": prompt,
            "schema": schema,
            "model": model,
            "effort": effort,
            "role": role,
            "runtime": runtime,
        }
        return hashlib.sha256(compact_json(material).encode()).hexdigest()

    def lock(self, key):
        lock = self.locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self.locks[key] = lock
        return lock

    def path(self, key):
        if len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
            raise ValueError("Invalid cache key")
        return self.root / key[:2] / f"{key}.json"

    def read(self, key):
        try:
            path = self.path(key)
            if path.stat().st_size > 2 * 1024 * 1024:
                return None
            data = json.loads(path.read_text(encoding="utf-8"))
            if (
                not isinstance(data, dict)
                or data.get("key") != key
                or data.get("version") != PIPELINE_VERSION
            ):
                return None
            output = data.get("output")
            if (
                data.get("output_sha256")
                != hashlib.sha256(compact_json(output).encode()).hexdigest()
            ):
                return None
            return output
        except (OSError, ValueError, TypeError):
            return None

    def write(self, key, output):
        path = self.path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f".{uuid4().hex}.tmp")
        data = {
            "key": key,
            "version": PIPELINE_VERSION,
            "created_at": now(),
            "output": output,
            "output_sha256": hashlib.sha256(compact_json(output).encode()).hexdigest(),
        }
        try:
            temporary.write_text(compact_json(data), encoding="utf-8")
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def record_metric(workspace, metric):
    path = workspace / "pipeline-metrics.json"
    data = (
        json.loads(path.read_text(encoding="utf-8"))
        if path.exists()
        else {"version": PIPELINE_VERSION, "stages": []}
    )
    data["stages"].append(metric)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(temporary, path)


def read_metrics(workspace):
    path = workspace / "pipeline-metrics.json"
    return (
        json.loads(path.read_text(encoding="utf-8"))
        if path.exists()
        else {"version": PIPELINE_VERSION, "stages": []}
    )
