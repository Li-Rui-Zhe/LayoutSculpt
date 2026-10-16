"""可复用的墙地面材质设计；将配方烘焙进不可变 PNG，随项目包携带。"""

import io
import json
import re
from typing import Literal

from PIL import Image, ImageChops, PngImagePlugin
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .surface_materials import FLOOR_MATERIALS, MATERIALS, ROOT, WALL_MATERIALS
from .surface_optics import SurfaceOptics


class SurfaceDesign(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    name: str = Field(min_length=1, max_length=60)
    category: Literal["walls", "floor"]
    base_id: str
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    repeat: int = Field(default=1, ge=1, le=6)
    rotation: Literal[0, 90, 180, 270] = 0
    roughness: float = Field(default=0.8, ge=0, le=1)
    optics: SurfaceOptics | None = None
    origin: Literal["preset", "draw", "ai", "upload"] = "preset"

    @model_validator(mode="after")
    def valid_base(self):
        if not self.name.strip():
            raise ValueError("请填写材质名称")
        allowed = WALL_MATERIALS if self.category == "walls" else FLOOR_MATERIALS
        if self.base_id not in allowed and not re.fullmatch(
            r"(?:source|texture):[a-f0-9]{64}", self.base_id
        ):
            raise ValueError("基础材质不属于当前墙面或地板分类")
        self.name = self.name.strip()
        return self


def render_surface(design: SurfaceDesign, data_dir=None):
    parameters = None
    item = MATERIALS.get(design.base_id, {})
    surface = item.get("surface") or {
        "wood": "planks",
        "stone": "stone",
        "linen": "linen",
    }.get(item.get("texture"))
    size = 720  # 可被 1..6 整除，避免密度为 5 时边界出现半块纹理。
    path = ROOT / f"public/materials/{surface}_color.png" if surface else None
    if design.base_id.startswith(("source:", "texture:")):
        root = data_dir if data_dir is not None else ROOT / "data"
        folder = (
            "material_sources" if design.base_id.startswith("source:") else "materials"
        )
        path = root / folder / f"{design.base_id.split(':')[1]}.png"
        if not path.is_file():
            raise ValueError("创作底图已丢失，请重新导入或从已保存素材继续绘制")
        with Image.open(path) as source:
            metadata = json.loads(source.info.get("surface_source", "null") or "null")
            parameters = source.info.get("surface_parameters")
        if metadata and metadata.get("category") != design.category:
            raise ValueError("创作底图与当前墙面/地板用途不匹配")
        if folder == "materials":
            previous = embedded_design(path)
            if previous and previous.category != design.category:
                raise ValueError("创作底图与当前墙面/地板用途不匹配")
    if path:
        with Image.open(path) as source:
            tile = source.convert("RGB").resize(
                (size // design.repeat, size // design.repeat)
            )
        image = Image.new("RGB", (size, size))
        for y in range(0, size, tile.height):
            for x in range(0, size, tile.width):
                image.paste(tile, (x, y))
        image = image.rotate(design.rotation)
    else:
        image = Image.new("RGB", (size, size), "white")
    image = ImageChops.multiply(image, Image.new("RGB", image.size, design.color))
    info = PngImagePlugin.PngInfo()
    info.add_text("surface_design", design.model_dump_json(exclude_none=True))
    if parameters:
        info.add_text("surface_parameters", parameters)
    output = io.BytesIO()
    image.save(output, format="PNG", pnginfo=info)
    return output.getvalue()


def embedded_design(path):
    with Image.open(path) as image:
        raw = image.info.get("surface_design")
    return SurfaceDesign.model_validate(json.loads(raw)) if raw else None


def apply_generation_surfaces(layout, options):
    """只在初次生成应用全屋选材；人工设计版本保留逐墙/逐房间覆盖。"""
    if options.get("wall_material"):
        for wall in layout.walls:
            wall.wall_material = options["wall_material"]
            wall.material_left = wall.material_right = None
            wall.finish_regions = []
    if options.get("floor_material"):
        for room in layout.rooms:
            room.floor_material = options["floor_material"]
    return layout
