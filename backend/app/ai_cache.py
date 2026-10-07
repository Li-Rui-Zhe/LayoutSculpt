"""Content-addressed cache of complete, validated AI responses only."""

import asyncio
import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4

from .store import now

PIPELINE_VERSION = "compact-structure-patch-v1"


def compact_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class StageCache:
    def __init__(self, root):
        self.root = Path(root)
        # Fixed buckets bound lock memory; same-key calls within this process
        # share a successful result rather than issuing duplicate inference.
        self.locks = [asyncio.Lock() for _ in range(32)]

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
        return self.locks[int(key[:2], 16) % len(self.locks)]

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
