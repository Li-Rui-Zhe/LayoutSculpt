"""本地 Codex 设计开放名称的材质配方；本机组合纹理，不执行 AI 脚本。"""

import asyncio
import io
from typing import Literal, TypedDict

import numpy as np
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph
from PIL import Image, ImageDraw
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .codex import CodexChatModel
from .surface_optics import SurfaceOptics
from .surface_patterns import TextureLayer, composite_layers

PRESETS = {
    "paint",
    "plaster",
    "tiles",
    "wood",
    "terrazzo",
    "linen",
    "panel",
    "stone",
    "glass",
    "metal",
}


class MaterialDesignError(ValueError):
    """可直接呈现给用户的设计限制；不包含模型的原始响应。"""


class MaterialParameters(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    name: str = Field(min_length=1, max_length=60)
    kind: str = Field(
        min_length=1,
        max_length=60,
        description="自由材质名称，例如羊毛地毯、软木、藤编；不限定类别",
    )
    preset: (
        Literal[
            "paint",
            "plaster",
            "tiles",
            "wood",
            "terrazzo",
            "linen",
            "panel",
            "stone",
            "glass",
            "metal",
        ]
        | None
    ) = None
    layers: list[TextureLayer] = Field(default_factory=list, max_length=8)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    accent: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    roughness: float = Field(ge=0, le=1)
    optics: SurfaceOptics | None = None
    intensity: float = Field(ge=0, le=1)
    density: int = Field(ge=1, le=6)
    layout: Literal["straight", "brick", "herringbone"]
    joint: float = Field(ge=0.002, le=0.05)
    note: str = Field(max_length=300)

    @model_validator(mode="after")
    def valid_layout(self):
        self.kind = self.kind.strip()
        if not self.kind:
            raise ValueError("请提供材质名称")
        base = self.base_preset
        if not base and not any(layer.opacity > 0 for layer in self.layers):
            raise ValueError(
                "自由材质需要有效纹理图层；请根据需求组合纤维、噪声、编织等特征，不能仅返回名称"
            )
        if base == "glass" and self.optics is None:
            self.optics = SurfaceOptics(transmission=0.95)
        if base == "metal" and self.optics is None:
            self.optics = SurfaceOptics(metalness=1)
        if self.layout == "herringbone" and base != "wood":
            raise ValueError("人字拼仅适用于木地板")
        if self.layout == "brick" and base not in {"wood", "tiles"}:
            raise ValueError("错缝仅适用于木地板或瓷砖")
        return self

    @property
    def base_preset(self):
        # 旧数据仍按 kind 选样板；新材质名称与绘制样板分离。
        return self.preset or (self.kind if self.kind in PRESETS else None)


def render_parameters(spec: MaterialParameters) -> bytes:
    kind = spec.base_preset
    size = 1024
    y, x = np.mgrid[:size, :size] / size
    rng = np.random.default_rng(42)
    cloud = np.zeros((size, size))
    for _ in range(16):
        a, b = rng.integers(1, 12, 2)
        cloud += np.sin(
            2 * np.pi * (x * a + y * b) + rng.uniform(0, 2 * np.pi)
        ) / np.hypot(a, b)
    cloud /= max(cloud.std(), 0.01)
    grain = rng.normal(0, 1, (size, size))
    tone = np.zeros_like(x)
    mask = np.zeros_like(x)
    u, v = x * spec.density, y * spec.density
    if kind == "plaster":
        tone = (cloud * 5 + grain * 0.8) * spec.intensity
    elif kind == "stone":
        veins = np.exp(
            -np.square(np.sin(2 * np.pi * (x * 3 + y * 2) + cloud * 0.6)) * 90
        )
        mask = veins * spec.intensity * 0.7
        tone = cloud * spec.intensity
    elif kind == "tiles":
        if spec.layout == "brick":
            u = u + (np.floor(v * 2) % 2) * 0.5
            v *= 2
        mask = ((u % 1 < spec.joint) | (v % 1 < spec.joint)).astype(float)
        tone = grain * spec.intensity * 0.5
    elif kind == "wood":
        if spec.layout == "herringbone":
            u, v = x * 8 * spec.density, y * 8 * spec.density
            horizontal = ((np.floor(u) - np.floor(v)) % 8) < 4
            a, b = np.where(horizontal, u, v), np.where(horizontal, v, u)
            offset = np.where(horizontal, np.floor(v), np.floor(u) - 4)
            joints = ((b % 1) < spec.joint) | (((a - offset) % 4) < spec.joint)
            # 整数周期保证画布两端可连续重复。
            fibers = np.sin(2 * np.pi * (b * 3 + 0.15 * np.sin(a * 2 * np.pi / 8)))
            board = (np.floor(a - offset) // 4 + np.floor(b) * 7) % 4 - 1.5
        else:
            u, v = x * 4 * spec.density, y * 2 * spec.density
            if spec.layout == "brick":
                v += (np.floor(u) % 2) * 0.5
            joints = ((u % 1) < spec.joint) | ((v % 1) < spec.joint)
            fibers = np.sin(2 * np.pi * (x * 64 + 0.4 * np.sin(y * 2 * np.pi)))
            board = np.floor(u) % 4 - 1.5
        mask = joints.astype(float) * 0.7
        tone = (fibers * 9 + board * 3 + grain * 0.5) * spec.intensity
    elif kind == "panel":
        mask = ((x * spec.density * 4) % 1 < spec.joint).astype(float)
        tone = grain * spec.intensity * 0.4
    elif kind == "linen":
        tone = (
            np.sin(x * 2 * np.pi * 128)
            * np.sin(y * 2 * np.pi * 128)
            * 12
            * spec.intensity
        )
    elif kind == "terrazzo":
        # 环绕绘制碎石，边缘颗粒不会在重复铺贴时被截断。
        chips = Image.new("L", (size, size), 0)
        draw = ImageDraw.Draw(chips)
        for _ in range(240 * spec.density):
            cx, cy = rng.random(2) * size
            radius = rng.uniform(0.002, 0.009) * size
            level = int(rng.uniform(0.2, 0.85) * spec.intensity * 255)
            for ox in (-size, 0, size):
                for oy in (-size, 0, size):
                    draw.ellipse(
                        (
                            cx + ox - radius,
                            cy + oy - radius * 0.7,
                            cx + ox + radius,
                            cy + oy + radius * 0.7,
                        ),
                        fill=level,
                    )
        mask = np.asarray(chips) / 255

    def rgb(value):
        return np.array([int(value[i : i + 2], 16) for i in (1, 3, 5)])

    color = rgb(spec.color) * (1 - mask[..., None]) + rgb(spec.accent) * mask[..., None]
    pixels = np.clip(color + tone[..., None], 0, 255)
    image = Image.fromarray(composite_layers(pixels, spec.layers))
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


class MaterialState(TypedDict, total=False):
    parameters: MaterialParameters
    content: bytes


async def generate_material(service, identifier, request):
    workspace = service.settings.data_dir / "material_jobs" / identifier
    workspace.mkdir(parents=True, exist_ok=True)
    instructions, _ = service.registry.compose("surface-material")
    (workspace / "skills.md").write_text(instructions, encoding="utf-8")

    async def design_node(state):
        llm = CodexChatModel(
            client=service.client,
            workspace=workspace,
            image=None,
            instructions=instructions,
            response_schema=MaterialParameters.model_json_schema(),
            model_name=request.model,
            reasoning_effort=request.reasoning_effort or service.settings.codex_effort,
        )
        chain = (
            ChatPromptTemplate.from_messages(
                [("human", "用途：{category}\n材质要求：{prompt}\n{repair}")]
            )
            | llm
            | PydanticOutputParser(pydantic_object=MaterialParameters)
        )
        variables = {
            "category": request.category,
            "prompt": request.prompt,
            "repair": "",
        }
        for attempt in range(2):
            try:
                spec = await chain.ainvoke(variables)
                return {"parameters": spec}
            except ValueError as exc:
                if attempt:
                    raise MaterialDesignError(
                        "材质配方未完成，请重试；现有设计已保留。"
                    ) from exc
                variables["repair"] = (
                    "上次配方未通过校验，请重新返回完整合法 JSON。材质名称不限类别；"
                    "新材质必须提供有效 layers，不能只写 unsupported 或返回空图层。"
                    "每层参数遵守 schema 范围；人字拼样板用 wood，错缝用 wood/tiles，其他用 straight。"
                )

    async def render_node(state):
        return {
            "content": await asyncio.to_thread(render_parameters, state["parameters"])
        }

    graph = StateGraph(MaterialState)
    graph.add_node("design", design_node)
    graph.add_node("render", render_node)
    graph.add_edge(START, "design")
    graph.add_edge("design", "render")
    graph.add_edge("render", END)
    result = await graph.compile().ainvoke({})
    return result["content"], result["parameters"]
