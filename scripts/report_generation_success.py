"""Read-only task statistics and optional replay of saved confirmed designs.

Replays use isolated output files. They do not call AI, confirm tasks, or count
as new-image recognition trials.
"""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.config import Settings
from backend.app.consistency import source_hash, structure_hash, verify_export
from backend.app.glb_builder import Builder
from backend.app.quality import finish_design, prepare_generated_furnishing
from backend.app.schemas import Furnishing, Layout


def category(error):
    message = (error or "").casefold()
    if "schema" in message:
        return "response_schema"
    if "not supported" in message or "不支持" in message:
        return "model_compatibility"
    if "超时" in message or "timeout" in message:
        return "timeout"
    if "重启" in message or "中断" in message:
        return "service_interruption"
    if "结构或原图发生变化" in message:
        return "structure_confirmation"
    return "other"


def ratio(numerator, denominator):
    return round(numerator / denominator * 100, 1) if denominator else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--replay", action="store_true")
    args = parser.parse_args()
    settings = Settings()
    output = settings.data_dir / "success-audits" / datetime.now().strftime("%Y%m%d-%H%M%S")
    output.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(f"file:{settings.db_path.as_posix()}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        jobs = [dict(row) for row in db.execute("SELECT * FROM jobs ORDER BY created_at")]
    groups = defaultdict(list)
    policies = defaultdict(Counter)
    counts = Counter(job["status"] for job in jobs)
    failure_categories = Counter()
    partial = 0
    for job in jobs:
        job["result"] = json.loads(job["result"]) if job["result"] else {}
        result = job["result"]
        policies[result.get("generation_policy_version", "legacy_or_unrecorded")][job["status"]] += 1
        if job["status"] == "failed":
            failure_categories[category(job["error"])] += 1
        if job["status"] == "succeeded" and result.get("delivery_status") == "structure_ready":
            partial += 1
        source = settings.workspace(job["id"]) / "source.png"
        if source.is_file():
            groups[source_hash(source)].append(job)
    ended = counts["succeeded"] + counts["failed"]
    report = {
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "task_count": len(jobs), "statuses": dict(counts),
        "finished_success_rate_percent": ratio(counts["succeeded"], ended),
        "finished_complete_result_rate_percent": ratio(counts["succeeded"] - partial, ended),
        "structure_only_deliveries": partial,
        "failure_categories": dict(failure_categories),
        "unique_source_count": len(groups),
        "historical_first_attempt_success_count": sum(items[0]["status"] == "succeeded" for items in groups.values()),
        "sources_with_at_least_one_success": sum(any(item["status"] == "succeeded" for item in items) for items in groups.values()),
        "policy_cohorts": {key: dict(value) for key, value in policies.items()},
        "limitations": [
            "历史任务包含修改版本和重试，已结束任务成功率不等于新原图首次成功率。",
            "同一原图按规范化后的 source.png 内容分组；不同裁剪或编码可能仍属于相同户型。",
            "结构交付与完整家具方案分别统计；任务成功不能证明与原图语义完全一致。",
            "回放复用已保存的结构和家具，不调用 AI，不属于新图片识别成功率试验。",
            "旧版本记录与当前策略须分开解读；当前策略真实样本不足时不推算成功率。",
        ],
        "saved_design_replays": [],
    }
    if args.replay:
        for number, items in enumerate(groups.values(), 1):
            successful = [job for job in items if job["status"] == "succeeded"]
            if not successful:
                continue
            job = successful[-1]
            replay = {"source_group": number, "job_id": job["id"], "status": "failed"}
            started = time.perf_counter()
            try:
                data = json.loads((settings.workspace(job["id"]) / "layout.json").read_text(encoding="utf-8"))
                layout = Layout.model_validate({key: data[key] for key in Layout.model_fields if key in data})
                plan = Furnishing.model_validate({"items": data.get("furniture", []), "notes": data.get("furniture_notes", [])})
                expected = structure_hash(layout)
                before = len(plan.items)
                automatic = job["result"].get("design_mode") != "manual"
                if automatic:
                    plan = prepare_generated_furnishing(plan, layout)
                layout, plan, quality = finish_design(layout, plan, automatic=automatic)
                assert structure_hash(layout) == expected, "回放改变了保存的建筑结构"
                document = {**layout.model_dump(), "furniture": plan.model_dump()["items"],
                            "furniture_notes": plan.notes, "style": data.get("style", "natural"),
                            "furniture_mode": data.get("furniture_mode", "library")}
                directory = output / "replays" / job["id"]
                directory.mkdir(parents=True)
                (directory / "layout.json").write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
                Builder(document, settings.furniture_catalog).build(directory)
                proof = verify_export(document, directory / "model.glb")
                (directory / "consistency.json").write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding="utf-8")
                replay.update(status="passed", structure_preserved=True,
                              geometry_verified=proof["geometry_verified"], outline_verified=proof["outline_verified"],
                              furniture_before=before, furniture_after=len(plan.items),
                              max_section_difference_m2=max((part["difference_m2"] for part in proof["sections"]), default=0))
            except Exception as exc:
                replay["error"] = str(exc)
            replay["elapsed_seconds"] = round(time.perf_counter() - started, 3)
            report["saved_design_replays"].append(replay)
    path = output / "report.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(path), **report}, ensure_ascii=False, indent=2))
    if any(item["status"] == "failed" for item in report["saved_design_replays"]):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
