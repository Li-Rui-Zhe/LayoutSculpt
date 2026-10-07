"""Build reusable supplemental furniture GLBs using the production Python geometry."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.furniture_details import construct
from backend.app.glb_builder import Builder


def main():
    catalog_path = ROOT / "assets/furniture/catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    for kind, name, size in [
        ("shower", "步入式玻璃淋浴间", [1, 1, 2.1]),
        ("refrigerator", "双门独立冰箱", [0.65, 0.65, 1.8]),
    ]:
        builder = Builder(
            {"outline": [{"x": 0, "y": 0}, {"x": 1, "y": 1}]}, catalog_path
        )
        construct(
            builder, dict(kind=kind, width=size[0], depth=size[1], height=size[2])
        )
        (catalog_path.parent / "glb" / f"{kind}.glb").write_bytes(
            builder.scene.export(file_type="glb")
        )
        catalog["items"] = [item for item in catalog["items"] if item["kind"] != kind]
        catalog["items"].append(
            {
                "id": f"habitat_{kind}",
                "kind": kind,
                "name": name,
                "dimensions": size,
                "format": "glb",
                "generator": "python",
                "triangles": sum(len(g.faces) for g in builder.scene.geometry.values()),
            }
        )
    catalog["version"] = "1.1.0"
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
