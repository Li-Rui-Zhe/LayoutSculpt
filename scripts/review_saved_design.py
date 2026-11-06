"""离线检查已保存户型；不调用 AI，不改原方案，不把检查通过当成识别正确。"""
import argparse
import json
from pathlib import Path
from time import perf_counter

from backend.app.schemas import Layout, Furnishing
from backend.app.quality import finish_design
from backend.app.lighting_summary import model_lighting_summary


def review(path):
    started = perf_counter()
    data = json.loads(path.read_text(encoding="utf-8"))
    layout = Layout.model_validate({k:v for k,v in data.items() if k in Layout.model_fields})
    plan = Furnishing(items=data.get("furniture", []), notes=[])
    _, _, report = finish_design(layout, plan, automatic=False)
    if (path.parent / "model.glb").is_file():
        report.update(model_lighting_summary(path.parent / "model.glb", (light.id for light in layout.lights)))
    report["check_seconds"] = round(perf_counter()-started, 3)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("layouts", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.resolve() in {path.resolve() for path in args.layouts}:
        parser.error("输出文件不能覆盖输入户型")
    reports = [{"case": path.parent.name, "report": review(path)} for path in args.layouts]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"mode":"offline_saved_design", "recognition_verified":False, "cases":reports}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已检查 {len(reports)} 个已保存方案，未调用 AI 或修改原方案。")


if __name__ == "__main__":
    main()
