"""只用可验证的本地来源记录补历史样板标记，不生成“人工已确认”。"""
import hashlib
import json
import re


def source_kind(settings, job):
    recorded = (job.get("result") or {}).get("consistency", {}).get("source_kind")
    if recorded:
        return recorded
    current = job["id"]
    visited = set()
    source = settings.workspace(current) / "source.png"
    for _ in range(30):
        if not isinstance(current, str) or not re.fullmatch(r"[a-f0-9]{32}", current) or current in visited:
            break
        visited.add(current)
        folder = settings.workspace(current)
        try:
            path = folder / "manifest.json"
            manifest = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
            if manifest.get("source") == "authored_sample":
                root = folder / "source.png"
                if source.is_file() and root.is_file() and hashlib.sha256(source.read_bytes()).digest() == hashlib.sha256(root.read_bytes()).digest():
                    return "authored_sample"
                break
            seed = json.loads((folder / "rebuild-seed.json").read_text(encoding="utf-8"))
            # 重新识别原图不沿用样板身份；仅沿确切的人工修改/重建链追溯。
            if seed.get("reidentify_of") or seed.get("restructure_of"):
                break
            current = seed.get("edited_of") or seed.get("rebuild_of") or ""
        except (OSError, ValueError, TypeError, AttributeError):
            break
    return "uploaded_plan"
