"""Measure planning/building against an isolated AI benchmark candidate.

This is a performance fixture, not a human confirmation. Exported evidence
must retain source_reviewed=false; no job in the user's database is changed.
"""

import argparse
import asyncio
import json
import shutil
import sys
import time
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from backend.app.ai_cache import read_metrics
from backend.app.codex import CodexClient
from backend.app.config import Settings
from backend.app.consistency import source_hash, structure_hash
from backend.app.schemas import Layout
from backend.app.skills import SkillRegistry
from backend.app.store import Store
from backend.app.workflow import JobRunner, create_graph


async def main(args):
    directory = Path(args.run).resolve(strict=True)
    if directory.parent != (ROOT / "data" / "ai-benchmarks").resolve():
        raise ValueError("只允许使用隔离性能验证目录")
    previous = json.loads((directory / "report.json").read_text(encoding="utf-8"))
    if not previous.get("validated"):
        raise ValueError("必须先通过识别及增量复核验证")
    initial_id = previous["runs"][0]["id"]
    settings = replace(Settings(), data_dir=directory)
    store = Store(settings.db_path)
    original = await store.get(initial_id)
    data = json.loads(
        (settings.workspace(initial_id) / "structure.json").read_text(encoding="utf-8")
    )
    layout = Layout.model_validate(
        {k: data[k] for k in Layout.model_fields if k in data}
    )
    source = settings.workspace(initial_id) / "source.png"
    client = CodexClient(settings)
    report = {
        "fixture_only": True,
        "human_confirmation": False,
        "original_candidate_id": initial_id,
        "runs": [],
    }
    runner = None
    try:
        await client.list_models(refresh=True)
        async with AsyncSqliteSaver.from_conn_string(
            str(directory / "graph.sqlite3")
        ) as checkpoints:
            await checkpoints.setup()
            runner = JobRunner(
                create_graph(
                    settings,
                    store,
                    client,
                    SkillRegistry(settings.skills_dir),
                    checkpoints,
                ),
                store,
                1,
                settings,
            )
            for phase in ("delivery_cold", "delivery_warm"):
                job_id = uuid4().hex
                workspace = settings.workspace(job_id)
                workspace.mkdir(parents=True)
                shutil.copyfile(source, workspace / "source.png")
                seed = {
                    "layout": layout.model_dump(),
                    "confirmed_structure": True,
                    "agents": [],
                    "confirmation": {
                        "source_sha256": source_hash(source),
                        "structure_hash": structure_hash(layout),
                        "method": "benchmark_fixture",
                    },
                }
                (workspace / "rebuild-seed.json").write_text(
                    json.dumps(seed, ensure_ascii=False), encoding="utf-8"
                )
                await store.create(
                    job_id, "隔离性能演练，未经人工确认", original["options"]
                )
                started = time.perf_counter()
                runner.schedule(job_id)
                task = runner.tasks[job_id]
                last = None
                while True:
                    job = await store.get(job_id)
                    if job["stage"] != last:
                        print(
                            json.dumps(
                                {
                                    "phase": phase,
                                    "id": job_id,
                                    "stage": job["stage"],
                                    "elapsed_seconds": round(
                                        time.perf_counter() - started, 3
                                    ),
                                },
                                ensure_ascii=False,
                            ),
                            flush=True,
                        )
                        last = job["stage"]
                    if job["status"] in {"succeeded", "failed", "cancelled"}:
                        break
                    await asyncio.wait({task}, timeout=5)
                metric = {
                    "phase": phase,
                    "id": job_id,
                    "status": job["status"],
                    "error": job["error"],
                    "elapsed_seconds": round(time.perf_counter() - started, 3),
                    "metrics": read_metrics(workspace),
                    "consistency": (job.get("result") or {}).get("consistency"),
                }
                report["runs"].append(metric)
                (directory / "delivery-report.json").write_text(
                    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                if job["status"] != "succeeded":
                    raise RuntimeError(job["error"])
                assert metric["consistency"]["source_reviewed"] is False
                assert (
                    metric["consistency"]["confirmation"]["method"]
                    == "benchmark_fixture"
                )
                assert metric["consistency"]["confirmation"][
                    "structure_hash"
                ] == structure_hash(layout)
            report["validated"] = True
            print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    finally:
        if runner:
            await runner.close()
        await client.stop()
        (directory / "delivery-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True)
    asyncio.run(main(parser.parse_args()))
