"""可组合的平铺纹理算子；材质名称自由，绘制预算和数值参数有界。"""

from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field


class TextureLayer(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    pattern: Literal[
        "solid", "noise", "fibers", "weave", "speckles", "veins", "stripes", "grid"
    ]
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    opacity: float = Field(ge=0, le=1)
    scale_x: int = Field(ge=1, le=256)
    scale_y: int = Field(ge=1, le=256)
    detail: float = Field(ge=0, le=1)
    coverage: float = Field(ge=0.01, le=1)
    angle: Literal[0, 45, 90, 135] = 0
    blend: Literal["mix", "multiply"] = "mix"
    seed: int = Field(default=42, ge=0, le=65535)


def periodic_noise(u, v, nx, ny, rng):
    """环面上的平滑值噪声，不裁剪旋转图片，避免平铺接缝。"""
    grid = rng.random((ny, nx))
    px, py = u * nx, v * ny
    ix, iy = np.floor(px).astype(int), np.floor(py).astype(int)
    fx, fy = px - ix, py - iy
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    return (
        grid[iy % ny, ix % nx] * (1 - fx) * (1 - fy)
        + grid[iy % ny, (ix + 1) % nx] * fx * (1 - fy)
        + grid[(iy + 1) % ny, ix % nx] * (1 - fx) * fy
        + grid[(iy + 1) % ny, (ix + 1) % nx] * fx * fy
    )


def pattern_mask(layer: TextureLayer, x, y):
    # 整数矩阵保持每个方向为整数周期；45 度的密度按对角方向解释。
    u, v = {0: (x, y), 45: (x + y, y - x), 90: (y, -x), 135: (y - x, -x - y)}[
        layer.angle
    ]
    rng = np.random.default_rng(layer.seed)
    sx, sy = layer.scale_x, layer.scale_y
    noise = periodic_noise(u, v, sx, sy, rng)
    px, py = u * sx, v * sy
    if layer.pattern == "solid":
        return np.ones_like(x)
    if layer.pattern == "noise":
        fine = periodic_noise(u, v, min(sx * 4, 512), min(sy * 4, 512), rng)
        field = noise * (1 - layer.detail * 0.5) + fine * layer.detail * 0.5
    elif layer.pattern == "fibers":
        # 长短纤维与弯曲交织，细节为二维色纹，不冒充真实绒毛几何。
        bend = periodic_noise(u, v, max(1, sx // 8), max(1, sy // 2), rng)
        strand = (np.sin(2 * np.pi * (px + layer.detail * bend * 2)) + 1) / 2
        field = strand * (0.35 + 0.65 * noise)
    elif layer.pattern == "weave":
        # 经纬交错以两根为一周期，奇数密度也需闭合为完整编织单元。
        px, py = u * max(2, sx - sx % 2), v * max(2, sy - sy % 2)
        a, b = (np.sin(2 * np.pi * px) + 1) / 2, (np.sin(2 * np.pi * py) + 1) / 2
        over = (np.floor(px) + np.floor(py)) % 2 == 0
        field = np.where(over, a * 0.8 + b * 0.2, b * 0.8 + a * 0.2)
        field *= 1 - layer.detail * 0.3 * noise
    elif layer.pattern == "speckles":
        ix, iy = np.floor(px).astype(int) % sx, np.floor(py).astype(int) % sy
        centers = rng.uniform(0.25, 0.75, (sy, sx, 2))
        radii = rng.uniform(0.12, 0.25, (sy, sx)) * np.sqrt(layer.coverage)
        distance = np.hypot(
            (px % 1) - centers[iy, ix, 0], (py % 1) - centers[iy, ix, 1]
        )
        edge = np.clip((radii[iy, ix] - distance) * 80 + 0.5, 0, 1)
        return edge * (1 - layer.detail * noise * 0.5)
    elif layer.pattern == "veins":
        field = (np.cos(2 * np.pi * (px + py + noise * layer.detail * 3)) + 1) / 2
    elif layer.pattern == "stripes":
        field = (np.cos(2 * np.pi * px) + 1) / 2
    else:  # grid：网格/拼接缝，可叠在任意材质之上。
        field = np.maximum(np.cos(2 * np.pi * px), np.cos(2 * np.pi * py)) * 0.5 + 0.5
    width = 0.06 if layer.pattern in {"veins", "stripes", "grid"} else 0.35
    return np.clip((field - (1 - layer.coverage)) / width + 0.5, 0, 1)


def composite_layers(image, layers):
    size = image.shape[0]
    y, x = np.mgrid[:size, :size] / size
    result = image.astype(float)
    for layer in layers:
        mask = pattern_mask(layer, x, y)[..., None] * layer.opacity
        color = np.array([int(layer.color[i : i + 2], 16) for i in (1, 3, 5)])
        target = result * color / 255 if layer.blend == "multiply" else color
        result = result * (1 - mask) + target * mask
    return np.clip(result, 0, 255).astype(np.uint8)
