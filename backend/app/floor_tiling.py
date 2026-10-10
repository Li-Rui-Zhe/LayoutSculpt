"""Dimensioned tile joints baked into the exported PBR colour texture."""

from copy import deepcopy
import numpy as np
from PIL import Image, ImageColor
from .surface_materials import MATERIALS, ROOT


def tiled_material(material, room):
    result = deepcopy(material)
    image = getattr(result, "baseColorTexture", None)
    identifier = room.get("floor_material")
    surface = MATERIALS.get(identifier, {}).get("surface")
    # Built-in swatches contain several planks/tiles. Extract a single face
    # before repeating it at the requested physical size, avoiding false joints.
    if image is not None:
        if surface == "tiles" or (result.name or "").endswith(("_tile", "_stone")):
            w, h = image.size
            image = image.crop(
                (max(1, round(w * 0.006)), max(1, round(h * 0.006)), w // 2, h // 2)
            )
        elif surface in {"boards", "herringbone"}:
            with Image.open(ROOT / "public/materials/veneer_color.png") as source:
                image = source.copy()
        elif not identifier and (result.name or "").startswith("地板"):
            w, h = image.size
            image = image.crop(
                (
                    max(1, round(w * 0.008)),
                    max(1, round(h * 0.008)),
                    max(2, round(w / 6) - 2),
                    h - 2,
                )
            )
    image = (
        image.convert("RGB").resize((512, 512))
        if image is not None
        else Image.new("RGB", (512, 512), "white")
    )

    def linearize(pixels):
        return np.where(
            pixels <= 0.04045, pixels / 12.92, ((pixels + 0.055) / 1.055) ** 2.4
        )

    factor = getattr(result, "baseColorFactor", None)
    linear = linearize(np.asarray(image) / 255)
    if factor is not None:
        linear *= np.asarray(factor)[:3] / 255
    joint = room.get("floor_grout", 0.003)
    edge = np.minimum(np.arange(512), np.arange(511, -1, -1))
    x = np.clip(256 * joint / room.get("floor_tile_width", 0.6) - edge, 0, 1)
    y = np.clip(256 * joint / room.get("floor_tile_depth", 0.6) - edge, 0, 1)
    # Fractional pixel coverage retains subpixel joints instead of rounding them
    # to zero or thickening them to the texture resolution.
    coverage = 1 - (1 - y[:, None]) * (1 - x[None, :])
    grout = linearize(
        np.asarray(ImageColor.getrgb(room.get("floor_grout_color", "#b9b5ad"))) / 255
    )
    linear = linear * (1 - coverage[..., None]) + grout * coverage[..., None]
    pixels = np.where(
        linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055
    )
    result.baseColorTexture = Image.fromarray(
        np.uint8(np.rint(np.clip(pixels * 255, 0, 255)))
    )
    height = (1 - coverage) * min(0.001, joint / 2)
    dx = (
        (np.roll(height, -1, 1) - np.roll(height, 1, 1))
        * 256
        / room.get("floor_tile_width", 0.6)
    )
    dy = (
        (np.roll(height, -1, 0) - np.roll(height, 1, 0))
        * 256
        / room.get("floor_tile_depth", 0.6)
    )
    normal = np.stack([-dx, -dy, np.ones_like(dx)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    result.normalTexture = Image.fromarray(np.uint8(np.rint((normal + 1) * 127.5)))
    result.baseColorFactor = [255, 255, 255, 255]
    result.name = f"{result.name}_规格铺贴"
    return result
