"""Repeatable image-to-layout evaluation using isolated jobs and real AI.

The authored drawings are regression fixtures, not a real-world accuracy claim.
AI self-reported confidence is never part of the score. Credentials remain in
the configured runtime; no user task, draft or human confirmation is modified.
"""
import argparse
import asyncio
import json
import shutil
import sqlite3
import sys
import time
from collections import Counter
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from PIL import Image, ImageDraw, ImageFont
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from shapely.geometry import Polygon, Point
from backend.app.ai_cache import read_metrics
from backend.app.codex import CodexClient
from backend.app.config import Settings
from backend.app.schemas import JobOptions
from backend.app.skills import SkillRegistry
from backend.app.store import Store
from backend.app.workflow import JobRunner, create_graph
from scripts.quality_cases import load_quality_cases


def fixtures(folder):
    folder.mkdir(parents=True, exist_ok=True)
    image = Image.open(ROOT / "public/sample-floorplan.png").convert("RGB")
    image.save(folder / "clear.png")
    image.resize((600, 468), Image.Resampling.LANCZOS).save(folder / "small.png")
    expected = {"size": [8, 6], "area": 48, "bedrooms": 1, "windows": 2, "doors": 1,
                "room_points": [["living", 2, 3], ["bedroom", 6.5, 3]],
                "opening_points": [["window", 2.05, 0], ["window", 6.65, 0], ["door", 4.5, 3.4]],
                "outline": [[0, 0], [8, 0], [8, 6], [0, 6]]}
    # A concavity and separate kitchen exercise a different topology.
    plan = Image.new("RGB", (1000, 850), "white")
    draw = ImageDraw.Draw(plan)
    font = ImageFont.load_default(size=24)
    points = [(100, 100), (900, 100), (900, 500), (500, 500), (500, 700), (100, 700), (100, 100)]
    draw.line(points, fill="black", width=12)
    draw.line([(500, 100), (500, 240)], fill="black", width=10)
    draw.line([(500, 330), (500, 500)], fill="black", width=10)
    draw.line([(100, 400), (260, 400)], fill="black", width=10)
    draw.line([(350, 400), (500, 400)], fill="black", width=10)
    for a, b in [((200, 100), (380, 100)), ((600, 100), (780, 100))]:
        draw.line([a, b], fill="#5599aa", width=13)
    draw.line([(500, 330), (590, 330)], fill="black", width=2)
    draw.arc((410, 240, 590, 420), 270, 360, fill="black", width=2)
    draw.line([(260, 400), (260, 490)], fill="black", width=2)
    draw.arc((170, 310, 350, 490), 0, 90, fill="black", width=2)
    for xy, text in [((420, 45), "8.0 m"), ((920, 270), "4.0 m"), ((200, 740), "4.0 m"),
                     ((20, 400), "6.0 m"), ((190, 240), "LIVING"), ((625, 270), "BEDROOM"), ((220, 540), "KITCHEN")]:
        draw.text(xy, text, fill="black", font=font)
    plan.save(folder / "concave.png")
    return {"clear": expected, "small": expected, "concave": {
        "size": [8, 6], "area": 40, "bedrooms": 1, "windows": 2, "doors": 2,
        "room_points": [["living", 2, 1.5], ["bedroom", 6, 2], ["kitchen", 2, 4.5]],
        "opening_points": [["window", 1.9, 0], ["window", 5.9, 0], ["door", 4, 1.85], ["door", 2.05, 3]],
        "outline": [[0, 0], [8, 0], [8, 4], [4, 4], [4, 6], [0, 6]]}}


def assess(layout, expected):
    points = layout.get("outline", [])
    if len(points) < 3:
        return {"passed": False, "reason": "没有有效结构"}
    x0, y0 = min(p["x"] for p in points), min(p["y"] for p in points)
    shape = Polygon([(p["x"] - x0, p["y"] - y0) for p in points])
    target = Polygon(expected["outline"])
    if not shape.is_valid or shape.area <= 0:
        return {"passed": False, "reason": "外轮廓无效"}
    iou = shape.intersection(target).area / shape.union(target).area
    counts = Counter(o["kind"] for o in layout.get("openings", []))
    bedrooms = sum(r["kind"] == "bedroom" for r in layout.get("rooms", []))
    checks = {"outline_iou": iou >= .85, "area_error": abs(shape.area - expected["area"]) / expected["area"] <= .12,
              "bedrooms": bedrooms == expected["bedrooms"], "windows": counts["window"] == expected["windows"],
              "doors": counts["door"] == expected["doors"]}
    checks["room_positions"] = all(any(r["kind"] == kind and Polygon([(p["x"]-x0, p["y"]-y0) for p in r["polygon"]]).buffer(.25).covers(Point(x,y))
        for r in layout.get("rooms", [])) for kind,x,y in expected["room_points"])
    walls = {w["id"]: w for w in layout.get("walls", [])}
    centers = []
    for opening in layout.get("openings", []):
        wall = walls.get(opening["wall_id"])
        if not wall:
            continue
        a,b = wall["start"], wall["end"]
        length = ((a["x"]-b["x"])**2 + (a["y"]-b["y"])**2)**.5
        if length:
            t = (opening["offset"]+opening["width"]/2)/length
            centers.append((opening["kind"], Point(a["x"]+(b["x"]-a["x"])*t-x0, a["y"]+(b["y"]-a["y"])*t-y0)))
    checks["opening_positions"] = all(any(k == kind and p.distance(Point(x,y)) <= .45 for k,p in centers)
                                       for kind,x,y in expected["opening_points"])
    return {"passed": all(checks.values()), "checks": checks, "outline_iou": round(iou, 4),
            "area": round(shape.area, 2), "bedrooms": bedrooms, "openings": dict(counts)}


async def main(args):
    base = Settings()
    directory = Path(args.resume).resolve() if args.resume else ROOT / "data/quality-benchmarks" / uuid4().hex
    if directory.parent != (ROOT / "data/quality-benchmarks").resolve():
        raise ValueError("只允许恢复隔离质量验收目录")
    expected = load_quality_cases(args.manifest, directory / "sources") if args.manifest else fixtures(directory / "sources")
    cases = args.cases.split(",") if args.cases else list(expected)
    if len(cases) != len(set(cases)) or set(cases) - expected.keys():
        raise ValueError("案例选择重复或不在清单内")
    settings = replace(base, data_dir=directory)
    # Resolve CLI and login against the real configured runtime, isolate only job data.
    client = CodexClient(base)
    store = Store(settings.db_path)
    await store.initialize()
    report = {"fixture_only": not bool(args.manifest), "human_confirmed": False, "model": args.model,
              "mode": args.mode, "effort": args.effort, "runs": []}
    previous_report = json.loads((directory / "report.json").read_text(encoding="utf-8")) if (directory / "report.json").exists() else {}
    if previous_report and any(previous_report.get(key) != report[key] for key in ("model", "mode", "effort", "fixture_only")):
        raise ValueError("恢复验收时模型、识别方式和强度必须与原记录一致")
    print(json.dumps({"directory": str(directory)}, ensure_ascii=False), flush=True)
    runner = None
    try:
        await client.list_models(refresh=True)
        async with AsyncSqliteSaver.from_conn_string(str(directory / "graph.sqlite3")) as checkpoint:
            await checkpoint.setup()
            runner = JobRunner(create_graph(settings, store, client, SkillRegistry(settings.skills_dir), checkpoint), store, 1, settings)
            for case in cases:
                with sqlite3.connect(settings.db_path) as db:
                    existing = db.execute("SELECT id FROM jobs WHERE name=? AND status IN ('awaiting_review','succeeded','failed') ORDER BY created_at DESC LIMIT 1", ("隔离质量验收 " + case,)).fetchone()
                identifier = existing[0] if existing else uuid4().hex
                workspace = settings.workspace(identifier)
                workspace.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(directory / "sources" / f"{case}.png", workspace / "source.png")
                options = JobOptions(model=args.model, reasoning_effort=args.effort,
                                     recognition_mode=args.mode, review_mode="manual")
                if not existing:
                    await store.create(identifier, "隔离质量验收 " + case, options.model_dump())
                started = time.perf_counter()
                task = None
                if not existing:
                    runner.schedule(identifier)
                    task = runner.tasks[identifier]
                previous = None
                while task and not task.done():
                    job = await store.get(identifier)
                    if job["stage"] != previous:
                        previous = job["stage"]
                        print(json.dumps({"case": case, "stage": previous, "seconds": round(time.perf_counter()-started)}, ensure_ascii=False), flush=True)
                    await asyncio.wait({task}, timeout=5)
                job = await store.get(identifier)
                path = workspace / "structure.json"
                data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
                row = {"case": case, "job": identifier, "status": job["status"], "error": job.get("error"),
                       "seconds": None if existing else round(time.perf_counter()-started, 2), "recovered_report": bool(existing), "quality": assess(data, expected[case]),
                       "metrics": read_metrics(workspace)}
                if existing:
                    row["seconds"] = next((r.get("seconds") for r in previous_report.get("runs", []) if r["job"] == identifier), None)
                report["runs"].append(row)
                (directory / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
                print(json.dumps(row, ensure_ascii=False), flush=True)
    finally:
        if runner:
            await runner.close()
        await client.stop()
        (directory / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--effort", default="medium")
    parser.add_argument("--mode", choices=["fast", "precise"], default="precise")
    parser.add_argument("--cases", help="逗号分隔的案例 ID，默认全部")
    parser.add_argument("--manifest", help="带独立人工标注的本地案例清单；显式运行会把图片发送给所选 AI 服务")
    parser.add_argument("--resume")
    asyncio.run(main(parser.parse_args()))
