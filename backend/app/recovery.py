"""Recover validated recognition without claiming AI or human review succeeded."""

import json

from .architecture import validate_generated_structure
from .consistency import source_hash, structure_hash
from .schemas import Layout


REVIEW_TIMEOUT_WARNING = "AI 结构复核超时，未完成复核。已保留识别结构，请逐项对照原图核对墙体、房间及门窗后再继续。"


def recoverable_recognition(settings, job):
    if job["status"] != "failed" or job["progress"] != 40:
        return None
    workspace = settings.workspace(job["id"])
    try:
        if (workspace / "rebuild-seed.json").exists():
            return None
        source = workspace / "source.png"
        if not source.is_file():
            return None
        layout = Layout.model_validate_json((workspace / "recognition.json").read_text(encoding="utf-8"))
        validate_generated_structure(layout)
        if not layout.rooms or not layout.walls:
            return None
        proof = workspace / "recognition-meta.json"
        if proof.exists():
            provenance = json.loads(proof.read_text(encoding="utf-8"))
            if provenance.get("source_sha256") != source_hash(source) or provenance.get("structure_hash") != structure_hash(layout):
                return None
        return layout
    except (OSError, ValueError, TypeError, KeyError):
        return None
