"""Material definitions shared with the React material library."""
import json
from pathlib import Path
from PIL import Image
from trimesh.visual.material import PBRMaterial

ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((ROOT / "assets/materials/catalog.json").read_text(encoding="utf-8"))
FLOOR_MATERIALS = tuple(CATALOG["categories"]["floor"])
MATERIALS = {item["id"]: item for item in CATALOG["items"]}


def floor_material(identifier):
    if identifier not in FLOOR_MATERIALS:
        raise ValueError("未知的地板素材")
    item = MATERIALS[identifier]
    rgb = [int(item["color"][i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    surface = {"wood": "planks", "stone": "stone", "linen": "linen"}.get(item["texture"])
    kwargs = dict(name=f"地板_素材_{identifier}", baseColorFactor=[*linear, 1.0],
                  metallicFactor=0, roughnessFactor={"planks": 0.44, "stone": 0.62, "linen": 0.94}.get(surface, 0.8))
    if surface:
        for field, channel in [("baseColorTexture", "color"), ("normalTexture", "normal")]:
            with Image.open(ROOT / f"public/materials/{surface}_{channel}.png") as image:
                kwargs[field] = image.copy()
    return PBRMaterial(**kwargs)
