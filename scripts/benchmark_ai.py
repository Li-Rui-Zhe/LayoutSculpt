"""Measure real AI cold/warm stages in an isolated database; never confirm a user task."""

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
from backend.app.consistency import source_hash
from backend.app.schemas import JobOptions
from backend.app.skills import SkillRegistry
from backend.app.store import Store, now
from backend.app.workflow import JobRunner, create_graph


async def main(args):
    source = Path(args.source).resolve(strict=True)
    directory = ROOT / "data" / "ai-benchmarks" / uuid4().hex
    directory.mkdir(parents=True)
    settings = replace(Settings(), data_dir=directory)
    client = CodexClient(settings)
    store = Store(settings.db_path)
    await store.initialize()
    report = {
        "created_at": now(),
        "source_sha256": source_hash(source),
        "model": args.model,
        "reasoning_effort": args.effort,
        "directory": str(directory),
        "runs": [],
    }
    (directory.parent / "latest.json").write_text(
        json.dumps({"directory": str(directory)}, indent=2), encoding="utf-8"
    )
    runner = None
    try:
        catalog = await client.list_models(refresh=True)
        selected = next((m for m in catalog["items"] if m["id"] == args.model), None)
        if (
            not selected
            or selected.get("available") is False
            or selected.get("supports_image") is False
        ):
            raise RuntimeError("指定模型不可用")
        if args.effort not in selected.get("efforts", []):
            raise RuntimeError("指定强度未列入本机支持目录")
        options = JobOptions(model=args.model, reasoning_effort=args.effort)
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
            for phase in ("cold", "warm"):
                job_id = uuid4().hex
                workspace = settings.workspace(job_id)
                workspace.mkdir(parents=True)
                shutil.copyfile(source, workspace / "source.png")
                await store.create(job_id, "隔离性能验证", options.model_dump())
                started = time.perf_counter()
                runner.schedule(job_id)
                task = runner.tasks[job_id]
                last = None
                while True:
                    job = await store.get(job_id)
                    current = (job["status"], job["stage"])
                    if current != last:
                        print(
                            json.dumps(
                                {
                                    "phase": phase,
                                    "job_id": job_id,
                                    "status": job["status"],
                                    "stage": job["stage"],
                                    "elapsed_seconds": round(
                                        time.perf_counter() - started, 2
                                    ),
                                },
                                ensure_ascii=False,
                            ),
                            flush=True,
                        )
                        last = current
                    if job["status"] in {
                        "awaiting_review",
                        "succeeded",
                        "failed",
                        "cancelled",
                    }:
                        break
                    await asyncio.wait({task}, timeout=5)
                metric = {
                    "phase": phase,
                    "id": job_id,
                    "elapsed_seconds": round(time.perf_counter() - started, 3),
                    "status": job["status"],
                    "error": job["error"],
                    "ai_review": (job.get("result") or {}).get("ai_review"),
                    "revision": (job.get("result") or {}).get("revision"),
                    "metrics": read_metrics(workspace),
                    "model_generated": (workspace / "model.glb").exists(),
                }
                report["runs"].append(metric)
                (directory / "report.json").write_text(
                    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                if (
                    job["status"] != "awaiting_review"
                    or metric["ai_review"]["status"] != "completed"
                ):
                    raise RuntimeError(
                        f"{phase} 未通过完整 AI 识别及复核验证：{job['error'] or metric['ai_review']}"
                    )
            cold, warm = report["runs"]
            assert cold["revision"] == warm["revision"]
            assert all(
                s["cache_hit"] and s["attempts"] == 0 for s in warm["metrics"]["stages"]
            )
            assert not any(r["model_generated"] for r in report["runs"])
            report["validated"] = True
            print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    finally:
        if runner:
            await runner.close()
        await client.stop()
        (directory / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--effort", default="medium")
    asyncio.run(main(parser.parse_args()))
