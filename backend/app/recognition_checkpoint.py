"""Preserve typed recognition candidates for an explicit user decision."""

import copy
import json

from pydantic import ValidationError
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import nearest_points

from .ai_contracts import LayoutExtraction, point_dict, room_dict, wall_dict
from .consistency import structure_hash
from .public_errors import public_message
from .schemas import Layout


class RecognitionCheckpoint(Exception):
    def __init__(self, candidate, attempts, trace):
        super().__init__("识别结果需要人工选择")
        self.candidate, self.attempts, self.trace = candidate, attempts, trace


def validation_summary(error):
    if isinstance(error, ValidationError):
        errors = error.errors(include_input=False, include_context=False, include_url=False)
        messages = [str(item["msg"]).removeprefix("Value error, ") for item in errors[:5]]
        return [readable_issue(public_message(message, "识别数据缺少必要信息或格式不完整")) for message in messages]
    return [readable_issue(public_message(error, "识别数据未通过校验"))]


def readable_issue(message):
    return message.replace("中心线超出户型轮廓", "伸出了户型的外边界").replace("房间多边形面积过小", "房间面积过小")


def saved_candidate(workspace):
    path = workspace / "recognition-validation.txt"
    if (workspace / "source.png").stat().st_mtime > path.stat().st_mtime + 0.001:
        raise ValueError("source changed after recognition")
    detail, raw = path.read_text(encoding="utf-8").split("\n\n", 1)
    wire = json.loads(raw)
    if not isinstance(wire, dict):
        raise TypeError("no usable candidate")
    check = wire.get("input_check")
    if check is not None and (not isinstance(check, dict) or check.get("status") == "rejected"):
        raise ValueError("no usable candidate")
    LayoutExtraction.model_validate({k: v for k, v in wire.items() if k != "input_check"})
    return detail, wire


def has_saved_candidate(workspace):
    try:
        saved_candidate(workspace)
        return True
    except (OSError, ValueError, TypeError, KeyError):
        return False


def checkpoint_candidate(wire, attempts):
    # Wire validation retains finite coordinates and typed, bounded components.
    # No invalid candidate is used by the model builder without Layout validation.
    wire = LayoutExtraction.model_validate({k: v for k, v in wire.items() if k != "input_check"})
    original = wire.model_dump()
    original.update(outline=[point_dict(p) for p in wire.outline],
                    rooms=[room_dict(r) for r in wire.rooms],
                    walls=[wall_dict(w) for w in wire.walls])
    candidate = copy.deepcopy(original)
    adjustments = []
    boundary = Polygon([(p["x"], p["y"]) for p in candidate["outline"]])
    if boundary.is_valid and boundary.area >= 2:
        for wall in candidate["walls"]:
            prior = copy.deepcopy(wall)
            start_adjustments = len(adjustments)
            for end in ("start", "end"):
                point = Point(wall[end]["x"], wall[end]["y"])
                distance = point.distance(boundary)
                # Only propose tiny endpoint corrections, never invent walls or
                # change room polygons. All proposals are disclosed before consent.
                if 1e-6 < distance <= min(0.15, wall["thickness"] / 2) + 1e-6:
                    snapped = nearest_points(boundary, point)[0]
                    wall[end] = {"x": snapped.x, "y": snapped.y}
                    adjustments.append(f"墙体 {wall['id']} 的端点向户型边界内调整 {distance * 100:.1f} 厘米")
            line = LineString([(wall[e]["x"], wall[e]["y"]) for e in ("start", "end")])
            if not boundary.buffer(1e-6).covers(line):
                # A parallel wall can lie just outside a concave corner even
                # when one endpoint is inside. Propose a bounded translation,
                # preserving the straight wall, its length and opening offsets.
                wall.update(prior)
                del adjustments[start_adjustments:]
                for end in ("start", "end"):
                    p = Point(prior[end]["x"], prior[end]["y"])
                    distance = p.distance(boundary)
                    if not 1e-6 < distance <= min(0.15, wall["thickness"] / 2) + 1e-6:
                        continue
                    snapped = nearest_points(boundary, p)[0]
                    dx, dy = snapped.x - p.x, snapped.y - p.y
                    moved = {e: {"x": prior[e]["x"] + dx, "y": prior[e]["y"] + dy} for e in ("start", "end")}
                    line = LineString([(moved[e]["x"], moved[e]["y"]) for e in ("start", "end")])
                    if boundary.buffer(1e-6).covers(line):
                        wall.update(moved)
                        adjustments.append(f"墙体 {wall['id']} 向户型边界内平移 {distance * 100:.1f} 厘米，保留长度与门窗位置")
                        break
    try:
        layout = Layout.model_validate(candidate)
        if not layout.rooms or not layout.walls:
            raise ValueError("识别结果缺少房间或墙体，请先补全平面图")
        candidate = layout.model_dump()
        blocking = []
    except (ValueError, ValidationError):
        # Do not show partially applied corrections when they cannot make the
        # candidate buildable. Let the user edit the original candidate instead.
        candidate, adjustments = original, []
        try:
            Layout.model_validate(original)
            blocking = ["识别结果缺少房间或墙体，请先补全平面图"]
        except (ValueError, ValidationError) as original_error:
            blocking = validation_summary(original_error)
    return candidate, {
        "attempts": attempts, "can_continue": not blocking,
        "blocking_issues": blocking, "adjustments": adjustments,
        "message": f"AI 已尝试 {len(attempts)} 次，结果仍未通过校验。请先查看平面图，再决定继续、调整或重新识别。",
    }


def save_checkpoint(state, workspace, pipeline_metrics):
    layout = state["layout"]
    document = {**layout, "furniture": [], "furniture_notes": []}
    (workspace / "structure.json").write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    (workspace / "review-seed.json").write_text(json.dumps({**state, "awaiting_review": False}, ensure_ascii=False), encoding="utf-8")
    area = Polygon([(p["x"], p["y"]) for p in layout["outline"]]).area
    return {"awaiting_review": True, "result": {
        "title": layout["title"], "area": round(area, 1), "room_count": len(layout["rooms"]),
        "scale_note": layout["scale_note"], "warnings": layout["warnings"],
        "revision": structure_hash(layout), "recognition_review": state["recognition_review"],
        **({"source_alignment_url": f"/api/jobs/{state['job_id']}/artifacts/source-alignment.json"} if state.get("source_alignment") else {}),
        "pipeline_metrics": pipeline_metrics,
        "layout_url": f"/api/jobs/{state['job_id']}/artifacts/structure.json",
    }}
