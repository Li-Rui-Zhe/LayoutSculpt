"""Compact AI transport and atomic, evidence-labelled structure corrections.

The saved Layout contract stays unchanged. Coordinates are never rounded,
snapped, simplified, or inferred by this transport layer.
"""

from typing import Annotated, Literal

from pydantic import Field

from .architecture import validate_generated_structure
from .consistency import structure_hash
from .schemas import Layout, LightFixture, Number, Opening, Room, StrictModel

XY = Annotated[list[Number], Field(min_length=2, max_length=2)]
CHECKS = {"outline", "scale", "rooms", "walls", "openings", "access"}


class RoomWire(Room):
    polygon: list[XY] = Field(min_length=3, max_length=24)


class WallWire(StrictModel):
    id: str = Field(min_length=1, max_length=40)
    a: XY = Field(description="墙中心线 start，坐标 [x,y]，单位米")
    b: XY = Field(description="墙中心线 end，坐标 [x,y]，单位米")
    t: float = Field(ge=0.06, le=0.6, description="实际墙厚 thickness，米")
    h: float = Field(ge=1.8, le=4.5, description="墙高 height，米")
    ext: bool = Field(description="是否外墙 exterior")
    finish: Literal["default", "white", "cream", "sage", "gray"] = "default"


class LayoutExtraction(StrictModel):
    title: str = Field(min_length=1, max_length=80)
    confidence: float = Field(ge=0, le=1)
    scale_note: str = Field(max_length=800)
    warnings: list[str] = Field(max_length=30)
    outline: list[XY] = Field(min_length=3, max_length=512)
    rooms: list[RoomWire] = Field(max_length=35)
    walls: list[WallWire] = Field(max_length=120)
    openings: list[Opening] = Field(max_length=80)
    lights: list[LightFixture] = Field(default_factory=list, max_length=12)


def point_dict(xy):
    return {"x": xy[0], "y": xy[1]}


def room_dict(room):
    data = room.model_dump()
    data["polygon"] = [point_dict(p) for p in room.polygon]
    return data


def wall_dict(wall):
    return {
        "id": wall.id,
        "start": point_dict(wall.a),
        "end": point_dict(wall.b),
        "thickness": wall.t,
        "height": wall.h,
        "exterior": wall.ext,
        "finish": wall.finish,
    }


def unpack_layout(wire):
    wire = LayoutExtraction.model_validate(wire) if isinstance(wire, dict) else wire
    data = wire.model_dump()
    data.update(
        outline=[point_dict(p) for p in wire.outline],
        rooms=[room_dict(r) for r in wire.rooms],
        walls=[wall_dict(w) for w in wire.walls],
    )
    layout = Layout.model_validate(data)
    validate_generated_structure(layout)
    return layout


def pack_layout(layout):
    layout = Layout.model_validate(layout) if isinstance(layout, dict) else layout
    data = layout.model_dump()
    data["outline"] = [[p.x, p.y] for p in layout.outline]
    data["rooms"] = [
        {**r.model_dump(), "polygon": [[p.x, p.y] for p in r.polygon]}
        for r in layout.rooms
    ]
    data["walls"] = [
        {
            "id": w.id,
            "a": [w.start.x, w.start.y],
            "b": [w.end.x, w.end.y],
            "t": w.thickness,
            "h": w.height,
            "ext": w.exterior,
            "finish": w.finish,
        }
        for w in layout.walls
    ]
    return LayoutExtraction.model_validate(data).model_dump()


class RoomChange(StrictModel):
    action: Literal["add", "update", "delete"]
    id: str = Field(min_length=1, max_length=40)
    value: RoomWire | None
    evidence: str = Field(min_length=1, max_length=240)


class WallChange(StrictModel):
    action: Literal["add", "update", "delete"]
    id: str = Field(min_length=1, max_length=40)
    value: WallWire | None
    evidence: str = Field(min_length=1, max_length=240)


class OpeningChange(StrictModel):
    wall_id: str = Field(min_length=1, max_length=40)
    values: list[Opening] = Field(
        max_length=80, description="该墙全部开口；明确删除所有开口才可为空"
    )
    evidence: str = Field(min_length=1, max_length=240)


class OutlineChange(StrictModel):
    points: list[XY] = Field(min_length=3, max_length=512)
    evidence: str = Field(min_length=1, max_length=240)


class LayoutReviewPatch(StrictModel):
    base_revision: str = Field(min_length=64, max_length=64)
    checks: list[
        Literal["outline", "scale", "rooms", "walls", "openings", "access"]
    ] = Field(min_length=6, max_length=6)
    summary: str = Field(min_length=1, max_length=400)
    warnings: list[str] = Field(max_length=20)
    outline: OutlineChange | None = None
    rooms: list[RoomChange] = Field(default_factory=list, max_length=35)
    walls: list[WallChange] = Field(default_factory=list, max_length=120)
    openings: list[OpeningChange] = Field(default_factory=list, max_length=80)
    confidence: float | None = Field(default=None, ge=0, le=1)
    scale_note: str | None = Field(default=None, min_length=1, max_length=800)


def apply_review_patch(layout, patch):
    """Validate the full proposed result before returning any change."""
    patch = (
        LayoutReviewPatch.model_validate(patch) if isinstance(patch, dict) else patch
    )
    if patch.base_revision != structure_hash(layout):
        raise ValueError("复核补丁的结构版本不匹配，禁止套用其他户型结果")
    if set(patch.checks) != CHECKS:
        raise ValueError("复核必须覆盖轮廓、比例、房间、墙体、开口及通行关系")
    data = layout.model_dump()
    for key, changes, convert in (
        ("rooms", patch.rooms, room_dict),
        ("walls", patch.walls, wall_dict),
    ):
        objects = {item["id"]: item for item in data[key]}
        seen = set()
        for change in changes:
            if change.id in seen or not change.evidence.strip():
                raise ValueError(f"{key} 修改重复或缺少原图依据：{change.id}")
            seen.add(change.id)
            if change.action == "add":
                if change.id in objects:
                    raise ValueError(f"新增 {key} ID 已存在：{change.id}")
            elif change.id not in objects:
                raise ValueError(f"待修改 {key} ID 不存在：{change.id}")
            if change.action == "delete":
                if change.value is not None:
                    raise ValueError("删除操作不能携带替换值")
                del objects[change.id]
            else:
                if change.value is None or change.value.id != change.id:
                    raise ValueError("修改对象 ID 与替换值不一致")
                objects[change.id] = convert(change.value)
        data[key] = list(objects.values())
    if patch.outline:
        if not patch.outline.evidence.strip():
            raise ValueError("轮廓修改缺少原图依据")
        data["outline"] = [point_dict(p) for p in patch.outline.points]
    seen = set()
    known_walls = {w.id for w in layout.walls} | {w["id"] for w in data["walls"]}
    for change in patch.openings:
        if (
            change.wall_id in seen
            or change.wall_id not in known_walls
            or not change.evidence.strip()
        ):
            raise ValueError("开口修改引用未知墙体、重复修改或缺少依据")
        if any(o.wall_id != change.wall_id for o in change.values):
            raise ValueError("开口替换值与目标墙体不一致")
        seen.add(change.wall_id)
        data["openings"] = [
            o for o in data["openings"] if o["wall_id"] != change.wall_id
        ] + [o.model_dump() for o in change.values]
    if patch.confidence is not None:
        data["confidence"] = patch.confidence
    if patch.scale_note is not None:
        data["scale_note"] = patch.scale_note
    # Keep every warning. Reaching the bound asks the model to consolidate its
    # additions rather than silently dropping uncertainty from the recognition.
    data["warnings"] = list(dict.fromkeys(layout.warnings + patch.warnings))
    proposed = Layout.model_validate(data)
    if not proposed.rooms or not proposed.walls:
        raise ValueError("复核不能清空户型房间或墙体")
    validate_generated_structure(proposed)
    return proposed
