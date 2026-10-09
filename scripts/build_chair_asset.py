"""重建弧面软包餐椅 GLB 与缩略图；造型定义同 Blender 作者工具共用。"""
import json
from pathlib import Path
import sys

import trimesh
from PIL import Image
from trimesh.visual.material import PBRMaterial

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.chair_mesh import chair_parts
from scripts.render_asset_thumbnails import render


def build():
    folder = ROOT / "assets/furniture"
    materials = {}
    for role, name, roughness in [("wood", "木材_实木", .57), ("fabric", "软装_织物", .92)]:
        with Image.open(ROOT / f"public/materials/natural_{role}_color.png") as image:
            texture = image.copy()
        materials[role] = PBRMaterial(name=name, baseColorTexture=texture,
                                      baseColorFactor=[255, 255, 255, 255],
                                      roughnessFactor=roughness, metallicFactor=0)
    scene = trimesh.Scene()
    for part in chair_parts():
        mesh = trimesh.Trimesh(vertices=part["vertices"], faces=part["faces"], process=True)
        mesh.fix_normals()
        # Stable planar UVs, with a vertical grain on the timber legs.
        uv = mesh.vertices[:, [0, 1]] * [2, 1.8] if part["role"] == "wood" else mesh.vertices[:, [0, 1] if "靠背" in part["name"] else [0, 2]] * 3
        mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=materials[part["role"]])
        scene.add_geometry(mesh, node_name=part["name"], geom_name=part["name"])
    path = folder / "glb/chair.glb"
    path.write_bytes(scene.export(file_type="glb"))
    render(path, folder / "thumbnails/chair.png")
    catalog_path = folder / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    entry = next(item for item in catalog["items"] if item["kind"] == "chair")
    entry.update(name="弧面软包实木餐椅", revision="2.2.1", generator="python",
                 triangles=sum(len(mesh.faces) for mesh in scene.geometry.values()))
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    print("CHAIR_COMPLETE", len(scene.geometry), entry["triangles"], path.stat().st_size)


if __name__ == "__main__":
    build()
