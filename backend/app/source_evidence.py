"""Image-space evidence, deterministic calibration and source comparisons.

Evidence comes from independent image reads. Agreement is a comparison of
model observations, never a claim that the original image has been verified.
"""

import copy
import math
from statistics import median
from typing import Annotated, Literal

import numpy as np
from PIL import Image, ImageOps
from pydantic import Field, field_validator
from shapely.geometry import LineString, Point, Polygon

from .architecture import wall_line
from .floorplan_inference import classify_points
from .input_quality import InputCheck, SourceImageRejected
from .recognition_contract import RecognitionOpening, RecognitionRoom
from .schemas import StrictModel
from .wall_evidence import wall_findings

Pixel = Annotated[float, Field(ge=0, le=4096, allow_inf_nan=False)]
PixelPoint = Annotated[list[Pixel], Field(min_length=2, max_length=2)]


class ImageWall(StrictModel):
    a: PixelPoint
    b: PixelPoint


class ImageOpening(StrictModel):
    kind: Literal["door", "window", "passage"]
    a: PixelPoint
    b: PixelPoint
    certainty: Literal["clear", "uncertain"]


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
    openings_px: list[ImageOpening] = Field(default_factory=list, max_length=80, description="门、窗和通道在墙线上的洞口两端，使用整图像素。只记录图上可辨认的位置。")
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

    @field_validator("finish", mode="before")
    @classmethod
    def normalize_finish(cls, value):
        if isinstance(value, str) and value not in {"default", "white", "cream", "sage", "gray"}:
            return "default"
        return value


class DoorLeafPixels(StrictModel):
    hinge: PixelPoint
    tip: PixelPoint


class PixelOpening(RecognitionOpening):
    offset: float = Field(ge=0, le=8192, description="沿所属墙起点的距离，单位原图像素")
    width: float = Field(gt=0, le=8192, description="开口宽度，单位原图像素")
    leaf_px: DoorLeafPixels | None = Field(default=None, description="清晰单开平开门的门轴和已打开门扇的自由端，使用整图像素坐标；其余填 null")


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
    points.extend(p for o in evidence.openings_px for p in (o.a, o.b))
    if any(p[0] > width or p[1] > height for p in points):
        raise ValueError("原图定位坐标超出图片边界，请使用实际图片像素坐标")
    if len(evidence.outline_px) < 3:
        raise ValueError("缺少完整的原图外轮廓")
    if any(w.a == w.b for w in evidence.walls_px):
        raise ValueError("原图墙线不能是零长度")
    if any(o.a == o.b for o in evidence.openings_px):
        raise ValueError("请标出洞口在墙上的两个不同端点")
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


def _apply_door_leaf(opening, wall, leaf, alignment):
    """Resolve a visibly open leaf in image axes (x right, y down)."""
    if not leaf or not wall or opening["kind"] != "door" or opening["door_style"] != "hinged":
        return
    hinge, tip = leaf["hinge"], leaf["tip"]
    if any(x > alignment["image_width"] or y > alignment["image_height"] for x, y in (hinge, tip)):
        return
    centerline = LineString([wall.a, wall.b])
    width = opening["width"]
    if centerline.length == 0 or width < 8:
        return
    jambs = [centerline.interpolate(offset) for offset in (opening["offset"], opening["offset"] + width)]
    distances = [jamb.distance(Point(hinge)) for jamb in jambs]
    if min(distances) > width * 0.3 or not 0.6 * width <= math.dist(hinge, tip) <= 1.4 * width:
        return
    at_end = distances[1] < distances[0]
    fixed, opposite = reversed(jambs) if at_end else jambs
    cross = (opposite.x - fixed.x) * (tip[1] - hinge[1]) - (opposite.y - fixed.y) * (tip[0] - hinge[0])
    if abs(cross) < 0.2 * width * width:
        return
    opening.update(hinge="end" if at_end else "start", swing="right" if cross > 0 else "left")


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
    pixel_walls = {wall.id: wall for wall in output.walls}
    for opening in data["openings"]:
        leaf = opening.pop("leaf_px")
        _apply_door_leaf(opening, pixel_walls.get(opening["wall_id"]), leaf, alignment)
        opening["offset"] *= scale
        opening["width"] *= scale
    return data


def detail_views(source, workspace, evidence, *, prefix="recognition-detail", contrast_regions=()):
    """At most three same-coordinate crops from the source."""
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
            path = workspace / f"{prefix}-{len(views) + 1}.png"
            crop = image.crop(box)
            reason = region.reason
            # Make faint wall strokes visible without changing the crop's pixels
            # coordinates. The independent reader still uses the untouched source.
            if region.box in contrast_regions:
                crop = ImageOps.autocontrast(crop.convert("L"), cutoff=1)
                reason += "（灰阶对比已增强，坐标不变）"
            crop.save(path)
            paths.append(path)
            views.append({"image_index": len(views) + 2, "box": list(box), "reason": reason,
                          "coordinate_rule": "局部图坐标加 [left,top] 回到整图；所有输出仍使用整图像素坐标"})
    return paths, views


def _span_distance(a, b, c, d):
    """Largest endpoint error under the better of the two wall directions."""
    return min(max(math.dist(a, c), math.dist(b, d)),
               max(math.dist(a, d), math.dist(b, c)))


def opening_findings(layout, evidence, alignment):
    """Match clearly observed spans one-to-one; an omitted observation proves nothing."""
    clear = []
    for o in evidence.openings_px:
        if o.certainty != "clear" or math.dist(o.a, o.b) < 8:
            continue
        if not any(old.kind == o.kind and _span_distance(o.a, o.b, old.a, old.b) <= 2 for old in clear):
            clear.append(o)
    if not clear:
        return []
    ox, oy = alignment["origin_px"]
    scale = alignment["meters_per_pixel"]
    walls = {w["id"]: wall_line(w) for w in layout["walls"]}
    candidates = []
    for opening in layout["openings"]:
        wall = walls[opening["wall_id"]]
        start = wall.interpolate(opening["offset"])
        end = wall.interpolate(opening["offset"] + opening["width"])
        candidates.append((opening["kind"], (start.x, start.y), (end.x, end.y)))

    choices = []
    other_kinds = []
    for o in clear:
        a, b = [((x - ox) * scale, (y - oy) * scale) for x, y in (o.a, o.b)]
        span = math.dist(a, b)
        # Ignore small differences in where a reader placed the jambs on a thick line.
        tolerance = max(3 * scale, min(0.35, span * 0.3))
        nearby = []
        alternatives = set()
        for index, (kind, c, d) in enumerate(candidates):
            distance = _span_distance(a, b, c, d)
            if distance > tolerance:
                continue
            if kind == o.kind:
                nearby.append((distance, index))
            else:
                alternatives.add(kind)
        choices.append([index for _, index in sorted(nearby)])
        other_kinds.append(alternatives)

    # Keep an adjacent opening available if another observation can only match that one.
    owners = {}

    def match(observation, visited):
        for index in choices[observation]:
            if index in visited:
                continue
            visited.add(index)
            if index not in owners or match(owners[index], visited):
                owners[index] = observation
                return True
        return False

    findings = []
    names = {"door": "门", "window": "窗", "passage": "通道"}
    for i, o in enumerate(clear):
        if match(i, set()):
            continue
        xs, ys = zip(o.a, o.b)
        padding = max(4, math.dist(o.a, o.b) * 0.25)
        name = names[o.kind]
        message = f"原图此处标有{name}，当前结构缺少位置和宽度相符的{name}。"
        if len(other_kinds[i]) == 1 and not choices[i]:
            actual = names[next(iter(other_kinds[i]))]
            message = f"原图此处标为{name}，当前结构识别为{actual}，请核对类型。"
        findings.append({
            "code": "opening_mismatch", "blocking": True,
            "message": message,
            "box": [max(0, min(xs) - padding), max(0, min(ys) - padding),
                    min(alignment["image_width"], max(xs) + padding), min(alignment["image_height"], max(ys) + padding)],
        })
    return findings


def compare_source(layout, evidence, alignment, *, source=None):
    origin, scale = alignment["origin_px"], alignment["meters_per_pixel"]

    def px(p):
        return [p["x"] / scale + origin[0], p["y"] / scale + origin[1]]

    expected = Polygon(evidence.outline_px)
    actual = Polygon([px(p) for p in layout["outline"]])
    findings = opening_findings(layout, evidence, alignment)
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
    findings.extend(wall_findings(layout, evidence, alignment, source=source))
    if alignment["scale_uncertain"]:
        findings.append({"code": "scale_uncertain", "message": "尺寸比例仍需确认，请先检查平面图。", "blocking": True})
    return {"outline_overlap": round(overlap, 4), "findings": findings}


def _pale_wall_support(gray, centers, direction, radius, mask):
    """Check the stroke inside the candidate wall against the paper on both sides."""
    normal = np.array([-direction[1], direction[0]])
    flank = 2 * radius + 2
    offsets = np.r_[[-flank - 1, -flank], np.arange(-radius, radius + 1), [flank, flank + 1]]
    coords = np.rint(centers[:, None, :] + offsets[None, :, None] * normal).astype(int)
    height, width = gray.shape
    inside = ((coords[:, :, 0] >= 0) & (coords[:, :, 0] < width)
              & (coords[:, :, 1] >= 0) & (coords[:, :, 1] < height)).all(axis=1)
    if inside.mean() < .8:
        return False
    x, y = coords[inside].transpose(2, 0, 1)
    levels = gray[y, x].astype(float)
    paper = np.minimum(levels[:, :2].mean(axis=1), levels[:, -2:].mean(axis=1))
    contrast = paper[:, None] - levels[:, 2:-2]
    stroke_coords = coords[inside, 2:-2]

    def continuous_band(min_contrast, min_width):
        # Only count an unbroken band reaching the centerline (±1 px).
        # On diagonals two offsets can round to the same source pixel.
        dark = contrast >= min_contrast
        supported = np.zeros(len(dark), dtype=bool)
        first_start = max(0, radius - min_width)
        last_start = min(radius + 1, dark.shape[1] - min_width)
        for start in range(first_start, last_start + 1):
            end = start + min_width - 1
            distinct = (stroke_coords[:, start] != stroke_coords[:, end]).any(axis=1)
            supported |= dark[:, start:end + 1].all(axis=1) & distinct
        return supported.sum() >= .8 * len(centers)

    if not continuous_band(12, 2):
        return False
    kind = classify_points(mask, centers[inside], (width, height)) if mask is not None else None
    if kind in {"window", "door"}:
        return False
    return kind == "wall" or continuous_band(25, max(3, radius))


def image_wall_findings(source, layout, alignment, *, mask=None):
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
        centers = []
        openings = [o for o in layout["openings"] if o["wall_id"] == wall["id"]]
        for fraction in np.linspace(0.05, 0.95, min(300, max(16, int(length / 2)))):
            offset = fraction * length * scale
            if any(o["offset"] - scale * 2 <= offset <= o["offset"] + o["width"] + scale * 2 for o in openings):
                continue
            x, y = np.rint(a + (b - a) * fraction).astype(int)
            if 0 <= x < gray.shape[1] and 0 <= y < gray.shape[0]:
                centers.append((x, y))
                samples.append(bool(dark[max(0, y-radius):y+radius+1, max(0, x-radius):x+radius+1].any()))
        if len(samples) >= 12 and sum(samples) / len(samples) < 0.2:
            if _pale_wall_support(gray, np.array(centers), (b - a) / length, radius, mask):
                continue
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
