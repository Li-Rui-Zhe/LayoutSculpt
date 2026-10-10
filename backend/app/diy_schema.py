"""可编辑的 DIY 几何契约：仅数据，不接收脚本、文件路径或远程资产。"""

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from .surface_materials import MATERIALS


class DiyPart(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=40, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=60)
    material_id: Literal[tuple(MATERIALS)] | None = None
    edit_locked: bool = False
    edit_hidden: bool = False
    edit_group: str = Field(default="", max_length=120)
    shape: Literal["box", "rounded_box", "cylinder", "cone", "sphere"]
    x: float = Field(ge=-6, le=6)
    y: float = Field(ge=-6, le=6)
    z: float = Field(ge=0, le=3)
    width: float = Field(ge=0.01, le=6)
    depth: float = Field(ge=0.01, le=6)
    height: float = Field(ge=0.01, le=3)
    rotation: float = Field(ge=-360, le=360)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    roughness: float = Field(ge=0, le=1)
    metallic: float = Field(ge=0, le=1)


def design_bounds(parts):
    ranges = []
    for p in parts:
        a = math.radians(p.rotation)
        rx = (abs(math.cos(a)) * p.width + abs(math.sin(a)) * p.depth) / 2
        ry = (abs(math.sin(a)) * p.width + abs(math.cos(a)) * p.depth) / 2
        ranges.append((p.x - rx, p.y - ry, p.z, p.x + rx, p.y + ry, p.z + p.height))
    low = [min(r[i] for r in ranges) for i in range(3)]
    high = [max(r[i + 3] for r in ranges) for i in range(3)]
    return low, high


class DiyDesign(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    name: str = Field(min_length=1, max_length=60)
    category: Literal["furniture", "wall_panel", "decor"]
    parts: list[DiyPart] = Field(min_length=1, max_length=48)

    @model_validator(mode="after")
    def valid_geometry(self):
        if not self.name.strip() or any(not p.name.strip() for p in self.parts):
            raise ValueError("素材及部件名称不能为空")
        if len({p.id for p in self.parts}) != len(self.parts):
            raise ValueError("部件编号不能重复")
        low, high = design_bounds(self.parts)
        if any(high[i] - low[i] > limit + 1e-6 for i, limit in enumerate([6, 6, 3])):
            raise ValueError("组合后的宽、深不能超过 6 米，高不能超过 3 米")
        return self

    def dimensions(self):
        low, high = design_bounds(self.parts)
        return [
            max(minimum, high[i] - low[i]) for i, minimum in enumerate([0.1, 0.1, 0.02])
        ]


class DiyGenerate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(min_length=1, max_length=3000)
    model: str | None = Field(default=None, min_length=1, max_length=160)
    reasoning_effort: str | None = Field(default=None, min_length=1, max_length=40)
    base: DiyDesign | None = None
    target_part_id: str | None = Field(default=None, max_length=40)
    preserve_dimensions: bool = False

    @model_validator(mode="after")
    def valid_target(self):
        if self.target_part_id and (
            not self.base
            or not any(p.id == self.target_part_id for p in self.base.parts)
        ):
            raise ValueError("要修改的部件不存在")
        return self


class DiySave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    design: DiyDesign
    revision: int = Field(default=0, ge=0)
