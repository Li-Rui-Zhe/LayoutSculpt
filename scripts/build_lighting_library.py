"""Generate the catalogue from the same geometry used by saved designs."""
import hashlib
import json
import sys
from pathlib import Path
import trimesh

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.fixture_models import PRESETS, fixture_parts


def build():
    folder = ROOT / "public/models/lights"
    folder.mkdir(parents=True, exist_ok=True)
    catalog = []
    for preset in PRESETS:
        fixture = dict(preset, id=preset["kind"], x=0, y=0, temperature=3000, enabled=True)
        scene = trimesh.Scene()
        for index, (name, mesh, metadata) in enumerate(fixture_parts(fixture)):
            # Catalogue displays every fixture, including hanging lights.
            metadata["fixture_visual_placeholder"] = False
            scene.add_geometry(mesh, node_name=f"{name}_{index}", metadata=metadata)
        data = scene.export(file_type="glb")
        (folder / f"{preset['kind']}.glb").write_bytes(data)
        revision = hashlib.sha256(data).hexdigest()[:12]
        catalog.append(dict(preset, temperature=3000, revision=revision,
                            model_url=f"/models/lights/{preset['kind']}.glb?v={revision}",
                            thumbnail_url=f"/models/lights/{preset['kind']}.png?v={revision}"))
    (ROOT / "frontend/src/library/lightingCatalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已生成 {len(catalog)} 款共享灯具模型")


if __name__ == "__main__":
    build()
