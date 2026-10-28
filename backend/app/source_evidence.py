"""Image-space evidence, deterministic calibration and source comparisons.

Evidence comes from independent image reads. Agreement is a comparison of
model observations, never a claim that the original image has been verified.
"""

import copy
import math
from statistics import median
from typing import Annotated, Literal

import numpy as np
from PIL import Image
from pydantic import Field
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from .input_quality import InputCheck, SourceImageRejected
from .recognition_contract import RecognitionOpening, RecognitionRoom
from .schemas import StrictModel

Pixel = Annotated[float, Field(ge=0, le=4096, allow_inf_nan=False)]
PixelPoint = Annotated[list[Pixel], Field(min_length=2, max_length=2)]


class ImageWall(StrictModel):
    a: PixelPoint
    b: PixelPoint


class ImageLabel(StrictModel):
    name: str = Field(min_length=1, max_length=60)
    kind: Literal["living", "dining", "bedroom", "kitchen", "bathroom", "balcony", "hall", "study", "other"]
    point: PixelPoint
    certainty: Literal["clear", "uncertain"]


class DimensionEvidence(StrictModel):
    a: PixelPoint
    b: PixelPoint
    meters: float = Field(gt=0, le=60)
    evidence: str = Field(min_length=4, max_length=180)


class DetailRegion(StrictModel):
    box: Annotated[list[Pixel], Field(min_length=4, max_length=4)] = Field(description="原图矩形 [left,top,right,bottom]，不是宽高")
    reason: str = Field(min_length=4, max_length=180)


class SourceEvidence(StrictModel):
    input_check: InputCheck
    outline_px: list[PixelPoint] = Field(max_length=512, description="真实建筑外轮廓，保留室外凹口；拒绝图片时为空")
    walls_px: list[ImageWall] = Field(max_length=120, description="可见墙中心线，不根据房间功能补墙")
    labels: list[ImageLabel] = Field(max_length=35, description="原图可见房间名称或可辨认功能的中心位置，不编造新房间")
    dimensions: list[DimensionEvidence] = Field(max_length=12, description="可靠尺寸标注与对应的像素跨度；读不清则留空")
    regions: list[DetailRegion] = Field(max_length=3, description="需要局部细读的密集或不清晰区域，清晰简单图可为空")
    warnings: list[str] = Field(max_length=15)


class PixelRoom(RecognitionRoom):
    polygon: list[PixelPoint] = Field(min_length=3, max_length=24)


class PixelWall(StrictModel):
    id: str = Field(min_length=1, max_length=40)
    a: PixelPoint
    b: PixelPoint
    t: float = Field(gt=0, le=256, description="原图墙厚，单位像素")
    h: float = Field(ge=0.3, le=4.5, description="墙高，单位米")
    ext: bool
    boundary_type: Literal["wall", "parapet", "glass_railing", "glazing"] = "wall"
    sill_height: float = Field(default=0, ge=0, le=4.5)
    finish: Literal["default", "white", "cream", "sage", "gray"] = "default"


class PixelOpening(RecognitionOpening):
    offset: float = Field(ge=0, le=8192, description="沿所属墙起点的距离，单位原图像素")
    width: float = Field(gt=0, le=8192, description="开口宽度，单位原图像素")


class PixelLayoutExtraction(StrictModel):
    input_check: InputCheck
    title: str = Field(min_length=1, max_length=80)
    confidence: float = Field(ge=0, le=1)
    scale_note: str = Field(max_length=800)
    warnings: list[str] = Field(max_length=30)
    outline: list[PixelPoint] = Field(max_length=512)
    rooms: list[PixelRoom] = Field(max_length=35)
    walls: list[PixelWall] = Field(max_length=120)
    openings: list[PixelOpening] = Field(max_length=80)


def validate_evidence(evidence, image_size):
    if evidence.input_check.status == "rejected":
        raise SourceImageRejected(evidence.input_check)
    width, height = image_size
    points = [*evidence.outline_px, *(p for w in evidence.walls_px for p in (w.a, w.b)), *(l.point for l in evidence.labels), *(p for d in evidence.dimensions for p in (d.a, d.b))]
    if any(p[0] > width or p[1] > height for p in points):
        raise ValueError("原图定位坐标超出图片边界，请使用实际图片像素坐标")
    if len(evidence.outline_px) < 3:
        raise ValueError("缺少完整的原图外轮廓")
    if any(w.a == w.b for w in evidence.walls_px):
        raise ValueError("原图墙线不能是零长度")
    shape = Polygon(evidence.outline_px)
    if not shape.is_valid or shape.area < 16:
        raise ValueError("原图外轮廓自交或范围过小，请重新沿真实建筑边缘定位")
    for region in evidence.regions:
        left, top, right, bottom = region.box
        if not (left < right <= width and top < bottom <= height):
            raise ValueError("局部细读区域超出原图或没有面积")
    return evidence


def alignment_from_evidence(evidence, image_size):
    xs, ys = zip(*evidence.outline_px)
    ratios = [d.meters / math.dist(d.a, d.b) for d in evidence.dimensions if math.dist(d.a, d.b) >= 8]
    warnings = list(evidence.warnings)
    uncertain_scale = not ratios
    if ratios:
        scale = median(ratios)
        if max(ratios) / min(ratios) > 1.12:
            uncertain_scale = True
            warnings.append("不同尺寸标注推算的比例不一致，请对照原图确认尺寸。")
    else:
        scale = 10 / max(max(xs) - min(xs), max(ys) - min(ys))
        warnings.append("未读到可靠尺寸，暂按建筑长边 10 米估算，请确认实际尺寸。")
    if min(image_size) < 700:
        warnings.append(f"原图为 {image_size[0]}×{image_size[1]} 像素，小字和门窗细节可能不清楚；有高清原图时建议替换。")
    return {"version": 1, "image_width": image_size[0], "image_height": image_size[1],
            "origin_px": [min(xs), min(ys)], "meters_per_pixel": scale,
            "scale_uncertain": uncertain_scale, "warnings": list(dict.fromkeys(warnings)),
            "scale_basis": {"method": "median_read_dimensions" if ratios else "estimated_long_edge_10m", "anchor_count": len(ratios)},
            "evidence_outline": evidence.outline_px, "findings": [], "views": []}


def pixel_wire(output, alignment):
    if output.input_check.status == "rejected":
        raise SourceImageRejected(output.input_check)
    data = output.model_dump()
    origin, scale = alignment["origin_px"], alignment["meters_per_pixel"]
    basis = alignment.get("scale_basis", {}).get("method")
    count = alignment.get("scale_basis", {}).get("anchor_count", 0)
    data["scale_note"] = f"尺寸由程序根据 AI 读取的 {count} 条图上标注统一估算，实际尺寸仍需对照原图核对。" if basis == "median_read_dimensions" else "未读取可靠尺寸，暂按建筑长边 10 米估算，请确认实际尺寸。"

    def point(p):
        if p[0] > alignment["image_width"] or p[1] > alignment["image_height"]:
            raise ValueError("识别坐标超出原图范围")
        return [(p[0] - origin[0]) * scale, (p[1] - origin[1]) * scale]

    data["outline"] = [point(p) for p in data["outline"]]
    for room in data["rooms"]:
        room["polygon"] = [point(p) for p in room["polygon"]]
    for wall in data["walls"]:
        wall["a"], wall["b"] = point(wall["a"]), point(wall["b"])
        wall["t"] *= scale
    for opening in data["openings"]:
        opening["offset"] *= scale
        opening["width"] *= scale
    return data


def detail_views(source, workspace, evidence):
    """At most three original-resolution crops; the source is never redrawn."""
    views = []
    paths = []
    with Image.open(source) as image:
        for region in evidence.regions[:3]:
            left, top, right, bottom = region.box
            dx, dy = (right - left) * 0.15, (bottom - top) * 0.15
            box = (max(0, math.floor(left - dx)), max(0, math.floor(top - dy)),
                   min(image.width, math.ceil(right + dx)), min(image.height, math.ceil(bottom + dy)))
            if min(box[2] - box[0], box[3] - box[1]) < 24:
                continue
            if any(v["box"] == list(box) for v in views):
                continue
            path = workspace / f"recognition-detail-{len(views) + 1}.png"
            image.crop(box).save(path)
            paths.append(path)
            views.append({"image_index": len(views) + 2, "box": list(box), "reason": region.reason,
                          "coordinate_rule": "局部图坐标加 [left,top] 回到整图；所有输出仍使用整图像素坐标"})
    return paths, views


def compare_source(layout, evidence, alignment):
    origin, scale = alignment["origin_px"], alignment["meters_per_pixel"]

    def px(p):
        return [p["x"] / scale + origin[0], p["y"] / scale + origin[1]]

    expected = Polygon(evidence.outline_px)
    actual = Polygon([px(p) for p in layout["outline"]])
    findings = []
    overlap = actual.intersection(expected).area / actual.union(expected).area
    if overlap < 0.9:
        findings.append({"code": "outline_mismatch", "message": "识别外轮廓与独立读图的边界差异较大，请检查凹口是否被填平或漏掉。", "blocking": True})
    clear = [label for label in evidence.labels if label.certainty == "clear"]
    expected_beds = sum(label.kind == "bedroom" for label in clear)
    actual_beds = sum(room["kind"] == "bedroom" for room in layout["rooms"])
    uncertain_bedrooms = any(label.kind == "bedroom" and label.certainty == "uncertain" for label in evidence.labels)
    if expected_beds and not uncertain_bedrooms and expected_beds != actual_beds:
        findings.append({"code": "bedroom_count", "message": f"独立读图发现 {expected_beds} 个卧室，当前结果有 {actual_beds} 个，请检查是否多分或漏分。", "blocking": True})
    for label in clear:
        if label.kind in {"hall", "other"}:
            continue
        kinds = {"living", "dining"} if label.kind in {"living", "dining"} else {label.kind}
        shapes = [Polygon([px(p) for p in room["polygon"]]) for room in layout["rooms"] if room["kind"] in kinds]
        # Labels can sit on a border; allow a small pixel tolerance, not an
        # entire room of slack. Unknown functions remain user decisions.
        if not any(shape.buffer(3).covers(Point(label.point)) for shape in shapes):
            x, y = label.point
            findings.append({"code": "room_position", "message": f"原图“{label.name}”的位置与当前房间划分不同，请对照检查。", "blocking": True,
                             "box": [max(0, x - 20), max(0, y - 20), min(alignment["image_width"], x + 20), min(alignment["image_height"], y + 20)]})
    if evidence.walls_px and layout["walls"]:
        expected_walls = unary_union([LineString([w.a, w.b]) for w in evidence.walls_px if w.a != w.b])
        actual_walls = unary_union([LineString([px(w["start"]), px(w["end"])]) for w in layout["walls"]])
        tolerance = max(2, math.hypot(alignment["image_width"], alignment["image_height"]) * 0.006)
        unsupported = actual_walls.difference(expected_walls.buffer(tolerance)).length
        if actual_walls.length and unsupported / actual_walls.length > 0.2:
            findings.append({"code": "wall_position", "message": "部分识别墙线偏离独立读图的墙线，请在叠加图中检查多画、漏画或错位。", "blocking": True})
    if alignment["scale_uncertain"]:
        findings.append({"code": "scale_uncertain", "message": "尺寸比例仍需确认，请先检查平面图。", "blocking": True})
    return {"outline_overlap": round(overlap, 4), "findings": findings}


def image_wall_findings(source, layout, alignment):
    """Conservative ink-support hints, not wall segmentation or ground truth.

    Exclude openings and skip low-contrast plans. Empty white space behind a
    long proposed wall can flag disagreement even when two AI reads agree.
    """
    with Image.open(source) as image:
        gray = np.asarray(image.convert("L"))
    dark = gray < 110
    if not 0.02 <= float(dark.mean()) <= 0.5:
        return []
    origin, scale = alignment["origin_px"], alignment["meters_per_pixel"]
    findings = []
    for wall in layout["walls"]:
        if wall.get("boundary_type") in {"glass_railing", "glazing"}:
            continue
        a = np.array([wall["start"]["x"] / scale + origin[0], wall["start"]["y"] / scale + origin[1]])
        b = np.array([wall["end"]["x"] / scale + origin[0], wall["end"]["y"] / scale + origin[1]])
        length = float(np.linalg.norm(b - a))
        if length < 32:
            continue
        radius = max(2, min(7, math.ceil(wall["thickness"] / scale / 2)))
        samples = []
        openings = [o for o in layout["openings"] if o["wall_id"] == wall["id"]]
        for fraction in np.linspace(0.05, 0.95, min(300, max(16, int(length / 2)))):
            offset = fraction * length * scale
            if any(o["offset"] - scale * 2 <= offset <= o["offset"] + o["width"] + scale * 2 for o in openings):
                continue
            x, y = np.rint(a + (b - a) * fraction).astype(int)
            if 0 <= x < gray.shape[1] and 0 <= y < gray.shape[0]:
                samples.append(bool(dark[max(0, y-radius):y+radius+1, max(0, x-radius):x+radius+1].any()))
        if len(samples) >= 12 and sum(samples) / len(samples) < 0.2:
            support = sum(samples) / len(samples)
            findings.append({"code": "weak_image_wall", "wall_id": wall["id"], "support": round(support, 3),
                "message": f"墙体 {wall['id']} 在原图对应位置的墙线证据较弱，请检查是否错位或多画。",
                "blocking": support < 0.1,
                "box": [max(0, float(min(a[0], b[0])) - radius), max(0, float(min(a[1], b[1])) - radius),
                        min(gray.shape[1], float(max(a[0], b[0])) + radius), min(gray.shape[0], float(max(a[1], b[1])) + radius)]})
    return sorted(findings, key=lambda f: f["support"])[:6]


def update_comparison(alignment, comparison, *, independent=False):
    result = copy.deepcopy(alignment)
    result.update(comparison)
    result["independent_review"] = independent
    return result
