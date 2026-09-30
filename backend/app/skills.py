from __future__ import annotations

"""只拼接项目内选中的 Skill；为每个任务记录内容摘要，便于复现。"""
import hashlib
from pathlib import Path


class SkillRegistry:
    def __init__(self, root: Path):
        self.root = root

    def list(self):
        return [
            {
                "id": p.parent.name,
                "name": p.parent.name,
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest()[:16],
            }
            for p in sorted(self.root.glob("*/SKILL.md"))
        ]

    def compose(self, *names: str) -> tuple[str, list[dict]]:
        allowed = {item["id"]: item for item in self.list()}
        parts = []
        manifest = []
        for name in dict.fromkeys(names):
            if name not in allowed:
                raise ValueError(f"项目内不存在技能：{name}")
            text = (self.root / name / "SKILL.md").read_text(encoding="utf-8")
            parts.append(f'<project-skill name="{name}">\n{text}\n</project-skill>')
            manifest.append(allowed[name])
        return "\n\n".join(parts), manifest
