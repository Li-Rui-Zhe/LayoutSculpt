"""Codex → LangChain → GLB 建模的数据契约，所有长度以米计。"""

from typing import Annotated, Literal
import math

from pydantic import BaseModel, ConfigDict, Field, model_validator
from shapely.geometry import Polygon, LineString

Number = Annotated[float, Field(ge=-60, le=60, allow_inf_nan=False)]
Positive = Annotated[float, Field(gt=0, le=60, allow_inf_nan=False)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Point(StrictModel):
    x: Number
    y: Number


class Room(StrictModel):
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=60)
    kind: Literal[
        "living",
        "dining",
        "bedroom",
        "kitchen",
        "bathroom",
        "balcony",
        "hall",
        "study",
        "other",
    ]
    polygon: list[Point] = Field(min_length=3, max_length=24)
    floor_finish: Literal["default", "oak", "walnut", "tile", "stone"] = "default"
    floor_enabled: bool = True


class Wall(StrictModel):
    id: str = Field(min_length=1, max_length=40)
    start: Point
    end: Point
    thickness: float = Field(ge=0.06, le=0.6)
    height: float = Field(ge=1.8, le=4.5)
    exterior: bool
    finish: Literal["default", "white", "cream", "sage", "gray"] = "default"


class Opening(StrictModel):
    wall_id: str = Field(min_length=1, max_length=40)
    kind: Literal["door", "window", "passage"]
    offset: float = Field(ge=0, le=60)
    width: Positive
    height: float = Field(gt=0, le=4.5)
    bottom: float = Field(ge=0, le=3)
    door_leaf: bool = True
    hinge: Literal["start", "end"] = "start"
    swing: Literal["left", "right"] = "left"
    angle: float = Field(default=90.0, ge=0, le=110)


class LightFixture(StrictModel):
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=60)
    kind: Literal["bulb", "pendant", "floor_lamp"]
    x: Number
    y: Number
    elevation: float = Field(default=2.4, ge=0.3, le=4.5)
    lumens: float = Field(default=800, ge=0, le=3000)
    temperature: Literal[2700, 3000, 4000, 6500] = 3000
    enabled: bool = True


def signed_area(polygon: list[Point]) -> float:
    return (
        sum(a.x * b.y - b.x * a.y for a, b in zip(polygon, polygon[1:] + polygon[:1]))
        / 2
    )


def validate_polygon(polygon: list[Point], label: str):
    if not Polygon([(p.x, p.y) for p in polygon]).is_valid:
        raise ValueError(f"{label} 多边形不能自交、自接触或折返")
    if len({(p.x, p.y) for p in polygon}) != len(polygon):
        raise ValueError(f"{label} 多边形包含重复顶点")

    def cross(a, b, c):
        return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

    edges = list(zip(polygon, polygon[1:] + polygon[:1]))
    for i, (a, b) in enumerate(edges):
        for j, (c, d) in enumerate(edges):
            if j <= i + 1 or (i == 0 and j == len(edges) - 1):
                continue
            if (
                max(min(a.x, b.x), min(c.x, d.x))
                > min(max(a.x, b.x), max(c.x, d.x)) + 1e-7
            ):
                continue
            if (
                max(min(a.y, b.y), min(c.y, d.y))
                > min(max(a.y, b.y), max(c.y, d.y)) + 1e-7
            ):
                continue
            if (
                cross(a, b, c) * cross(a, b, d) <= 0
                and cross(c, d, a) * cross(c, d, b) <= 0
            ):
                raise ValueError(f"{label} 多边形不能自交或自接触")


def contains(point: Point, polygon: list[Point]) -> bool:
    """包含边界的奇偶规则，用于房间及家具归属检查。"""
    inside = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x)
        if (
            abs(cross) < 1e-5
            and min(a.x, b.x) - 1e-5 <= point.x <= max(a.x, b.x) + 1e-5
            and min(a.y, b.y) - 1e-5 <= point.y <= max(a.y, b.y) + 1e-5
        ):
            return True
        if (a.y > point.y) != (b.y > point.y) and point.x < (b.x - a.x) * (
            point.y - a.y
        ) / (b.y - a.y) + a.x:
            inside = not inside
    return inside


class Layout(StrictModel):
    title: str = Field(min_length=1, max_length=80)
    confidence: float = Field(ge=0, le=1)
    scale_note: str = Field(max_length=800)
    warnings: list[str] = Field(max_length=30)
    # Automatic wall/floor union retains concave corners and wall thickness.
    outline: list[Point] = Field(min_length=3, max_length=512)
    rooms: list[Room] = Field(max_length=35)
    walls: list[Wall] = Field(max_length=120)
    openings: list[Opening] = Field(max_length=80)
    lights: list[LightFixture] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def check_geometry(self):
        validate_polygon(self.outline, "外轮廓")
        if abs(signed_area(self.outline)) < 2:
            raise ValueError("户型外轮廓面积必须大于 2 平方米")
        for values, label in [(self.rooms, "房间"), (self.walls, "墙体")]:
            if len({v.id for v in values}) != len(values):
                raise ValueError(f"{label} ID 必须唯一")
        for room in self.rooms:
            validate_polygon(room.polygon, room.id)
            if abs(signed_area(room.polygon)) < 0.2:
                raise ValueError(f"{room.id} 房间多边形面积过小")
            if (
                not Polygon([(p.x, p.y) for p in self.outline])
                .buffer(1e-6)
                .covers(Polygon([(p.x, p.y) for p in room.polygon]))
            ):
                raise ValueError(f"{room.id} 房间超出外轮廓")
        walls = {w.id: w for w in self.walls}
        for wall in self.walls:
            if math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) < 0.05:
                raise ValueError(f"{wall.id} 墙体长度不足")
        for opening in self.openings:
            if opening.wall_id not in walls:
                raise ValueError(f"门窗引用不存在的墙体 {opening.wall_id}")
            w = walls[opening.wall_id]
            if (
                opening.offset + opening.width
                > math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) + 1e-6
            ):
                raise ValueError(f"{w.id} 门窗超出墙体")
            if opening.bottom + opening.height > w.height + 1e-6:
                raise ValueError(f"{w.id} 门窗超出墙体高度")
        for wall_id in walls:
            openings = sorted(
                [o for o in self.openings if o.wall_id == wall_id],
                key=lambda o: o.offset,
            )
            for first, second in zip(openings, openings[1:]):
                if first.offset + first.width > second.offset + 1e-6:
                    raise ValueError(f"{wall_id} 门窗开口相互重叠")
        outline = Polygon([(p.x, p.y) for p in self.outline]).buffer(1e-6)
        room_shapes = []
        for room in self.rooms:
            shape = Polygon([(p.x, p.y) for p in room.polygon])
            if any(shape.intersection(other).area > 1e-6 for other in room_shapes):
                raise ValueError(f"{room.name} 与其他房间地面重叠，请修正净空边界")
            room_shapes.append(shape)
        wall_lines = []
        for wall in self.walls:
            line = LineString([(wall.start.x, wall.start.y), (wall.end.x, wall.end.y)])
            if not outline.covers(line):
                raise ValueError(f"墙体 {wall.id} 中心线超出户型轮廓")
            if any(line.intersection(other).length > 1e-6 for other in wall_lines):
                raise ValueError(f"墙体 {wall.id} 与其他墙体存在重复线段")
            wall_lines.append(line)
        if any(o.bottom != 0 for o in self.openings if o.kind in {"door", "passage"}):
            raise ValueError("门和通道必须从地面开始")
        if len({light.id for light in self.lights}) != len(self.lights):
            raise ValueError("灯具 ID 必须唯一")
        for light in self.lights:
            if not contains(Point(x=light.x, y=light.y), self.outline):
                raise ValueError(f"灯具 {light.name} 超出户型轮廓")
        return self


class Furniture(StrictModel):
    name: str = Field(default="", max_length=60)
    room_id: str = Field(min_length=1, max_length=40)
    kind: Literal[
        "sofa",
        "bed",
        "table",
        "chair",
        "cabinet",
        "counter",
        "bathtub",
        "toilet",
        "sink",
        "plant",
        "rug",
        "desk",
        "shower",
        "refrigerator",
    ]
    x: Number
    y: Number
    width: float = Field(ge=0.1, le=6)
    depth: float = Field(ge=0.1, le=6)
    height: float = Field(ge=0.02, le=3)
    rotation: float = Field(ge=-360, le=360)


class Furnishing(StrictModel):
    items: list[Furniture] = Field(max_length=90)
    notes: list[str] = Field(max_length=20)


class JobOptions(StrictModel):
    style: Literal["natural", "cream", "modern"] = "natural"
    notes: str = Field(default="", max_length=3000)
    collaboration: bool = True
    model: str | None = Field(default=None, min_length=1, max_length=160)
    reasoning_effort: str | None = Field(default=None, min_length=1, max_length=40)
    furniture_mode: Literal["library", "basic"] = "library"


class RetryRequest(StrictModel):
    model: str | None = Field(default=None, min_length=1, max_length=160)
    reasoning_effort: str | None = Field(default=None, min_length=1, max_length=40)
    reuse_structure: bool = False

    @model_validator(mode="after")
    def recovery_keeps_original_model(self):
        if self.reuse_structure and ({"model", "reasoning_effort"} & self.model_fields_set):
            raise ValueError("恢复识别结构无需更换模型；如需重新识别，请使用普通重试")
        return self


class ManualEditRequest(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    layout: Layout
    furniture: Furnishing

    @model_validator(mode="after")
    def check_edit(self):
        validate_furnishing(self.furniture, self.layout)
        if not self.name.strip():
            raise ValueError("版本名称不能为空")
        outline = Polygon([(p.x, p.y) for p in self.layout.outline]).buffer(1e-6)
        for i, room in enumerate(self.layout.rooms):
            if not room.name.strip():
                raise ValueError("空间名称不能为空")
            shape = Polygon([(p.x, p.y) for p in room.polygon])
            for other in self.layout.rooms[:i]:
                if (
                    shape.intersection(
                        Polygon([(p.x, p.y) for p in other.polygon])
                    ).area
                    > 1e-6
                ):
                    raise ValueError(
                        f"空间「{room.name}」与「{other.name}」重叠，请调整边界或拆分空间"
                    )
        for i, wall in enumerate(self.layout.walls):
            line = LineString([(wall.start.x, wall.start.y), (wall.end.x, wall.end.y)])
            if not outline.covers(line):
                raise ValueError(f"墙体 {wall.id} 中心线超出户型轮廓")
            for other in self.layout.walls[:i]:
                previous = LineString(
                    [(other.start.x, other.start.y), (other.end.x, other.end.y)]
                )
                if line.intersection(previous).length > 1e-6:
                    raise ValueError(f"墙体 {wall.id} 与 {other.id} 存在重叠线段")
        for opening in self.layout.openings:
            if opening.kind in {"door", "passage"} and opening.bottom != 0:
                raise ValueError("门和通道必须从地面开始，离地高度应为 0")
        if len({light.id for light in self.layout.lights}) != len(self.layout.lights):
            raise ValueError("灯具 ID 必须唯一")
        for light in self.layout.lights:
            if not light.name.strip() or not contains(
                Point(x=light.x, y=light.y), self.layout.outline
            ):
                raise ValueError(f"灯具「{light.name}」名称为空或位置超出户型轮廓")
        return self


class StructureConfirmation(StrictModel):
    layout: Layout
    reviewed: Literal[True]
    revision: str = Field(min_length=64, max_length=64)


def validate_furnishing(plan: Furnishing, layout: Layout) -> Furnishing:
    rooms = {room.id: room for room in layout.rooms}
    for item in plan.items:
        room = rooms.get(item.room_id)
        if not room:
            raise ValueError(f"家具引用不存在的房间 {item.room_id}")
        angle = math.radians(item.rotation)
        corners = []
        for dx, dy in [(0, 0)] + [
            (x * item.width / 2, y * item.depth / 2)
            for x, y in [(-1, -1), (-1, 1), (1, 1), (1, -1)]
        ]:
            p = Point(
                x=item.x + dx * math.cos(angle) - dy * math.sin(angle),
                y=item.y + dx * math.sin(angle) + dy * math.cos(angle),
            )
            if not contains(p, room.polygon):
                raise ValueError(f"{item.kind} 家具超出 {room.name} 边界，请缩小或移动")
            if dx != 0 or dy != 0:
                corners.append((p.x, p.y))
        if (
            not Polygon([(p.x, p.y) for p in room.polygon])
            .buffer(1e-6)
            .covers(Polygon(corners))
        ):
            raise ValueError(
                f"{item.kind} 家具跨越 {room.name} 的凹形边界，请缩小或移动"
            )
    return plan
