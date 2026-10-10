"""Material definitions shared with the React material library."""

import json
import re
from pathlib import Path
from typing import Annotated
from pydantic import Field
from PIL import Image
from trimesh.visual.material import PBRMaterial

ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads(
    (ROOT / "assets/materials/catalog.json").read_text(encoding="utf-8")
)
FLOOR_MATERIALS = tuple(
    dict.fromkeys(
        CATALOG["categories"]["floor"]
        + CATALOG.get("legacy_categories", {}).get("floor", [])
    )
)
WALL_MATERIALS = tuple(CATALOG["categories"]["walls"])
MATERIALS = {item["id"]: item for item in CATALOG["items"]}
TEXTURE_PATTERN = r"^texture:[a-f0-9]{64}$"
TextureReference = Annotated[
    str, Field(pattern=TEXTURE_PATTERN, min_length=72, max_length=72)
]
CUSTOM_COLOR_PATTERN = r"^color:#[0-9a-fA-F]{6}$"


def surface_material(identifier, category="floor", texture_root=None):
    if isinstance(identifier, str) and re.fullmatch(TEXTURE_PATTERN, identifier):
        root = Path(texture_root) if texture_root else ROOT / "data/materials"
        path = root / f"{identifier.split(':')[1]}.png"
        if not path.is_file():
            raise ValueError("此自定义贴图缺失，请重新导入素材或恢复项目包")
        with Image.open(path) as image:
            return PBRMaterial(
                name=f"{'地板' if category == 'floor' else '墙面'}_素材_{identifier}",
                baseColorFactor=[255, 255, 255, 255],
                roughnessFactor=0.8,
                metallicFactor=0,
                baseColorTexture=image.copy(),
            )
    if isinstance(identifier, str) and re.fullmatch(CUSTOM_COLOR_PATTERN, identifier):
        item = {"color": identifier[6:], "texture": ""}
    elif identifier in (FLOOR_MATERIALS if category == "floor" else WALL_MATERIALS):
        item = MATERIALS[identifier]
    else:
        raise ValueError("未知的表面材质")
    rgb = [int(item["color"][i : i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    surface = item.get("surface") or {
        "wood": "planks",
        "stone": "stone",
        "linen": "linen",
    }.get(item["texture"])
    prefix = "地板" if category == "floor" else "墙面"
    kwargs = dict(
        name=f"{prefix}_素材_{identifier}",
        baseColorFactor=[*linear, 1.0],
        metallicFactor=0,
        roughnessFactor=item.get(
            "roughness",
            {"planks": 0.44, "stone": 0.62, "linen": 0.94}.get(surface, 0.8),
        ),
    )
    if surface:
        for field, channel in [
            ("baseColorTexture", "color"),
            ("normalTexture", "normal"),
        ]:
            with Image.open(
                ROOT / f"public/materials/{surface}_{channel}.png"
            ) as image:
                kwargs[field] = image.copy()
    return PBRMaterial(**kwargs)


def floor_material(identifier, texture_root=None):
    return surface_material(identifier, "floor", texture_root)


def wall_material(identifier, texture_root=None):
    if identifier not in WALL_MATERIALS and not re.fullmatch(
        TEXTURE_PATTERN, identifier or ""
    ):
        raise ValueError("未知的墙面素材")
    return surface_material(identifier, "walls", texture_root)
