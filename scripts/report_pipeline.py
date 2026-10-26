"""Aggregate existing stage measurements; no AI calls or task changes."""

import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from statistics import median

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.config import Settings


def summarize(root):
    groups = defaultdict(list)
    invalid = 0
    for file in (root / "jobs").glob("*/pipeline-metrics.json"):
        try:
            data = json.loads(file.read_text(encoding="utf-8"))
            for stage in data.get("stages", []):
                seconds = stage.get("elapsed_seconds")
                if not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds < 0:
                    continue
                key = (data.get("version", "unknown"), stage.get("role", "unknown"), stage.get("model") or "local", stage.get("reasoning_effort") or "default", bool(stage.get("cache_hit")), stage.get("status", "unknown"))
                groups[key].append(seconds)
        except (OSError, ValueError, TypeError, AttributeError):
            invalid += 1
    rows = []
    for (version, role, model, effort, cached, status), times in sorted(groups.items()):
        ordered = sorted(times)
        rows.append(dict(version=version, stage=role, model=model, effort=effort, cached=cached, status=status,
                         samples=len(times), median_seconds=round(median(times), 2),
                         p95_seconds=round(ordered[math.ceil(len(times) * .95) - 1], 2)))
    return {"groups": rows, "unreadable_records": invalid,
            "note": "按模型、强度、阶段、缓存及结果分组；耗时不代表识图准确性。样本少于 10 条时仅供排查，不用于改变默认复核策略。"}


if __name__ == "__main__":
    print(json.dumps(summarize(Settings().data_dir), ensure_ascii=False, indent=2))
