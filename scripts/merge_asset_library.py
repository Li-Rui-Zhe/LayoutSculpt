"""合并隔离制作的素材，避免 Blender 长批次堆积临时网格。"""
import hashlib
import json
import sys
import re
from pathlib import Path
import bpy

root = Path(__file__).resolve().parents[1]
workspace = Path(sys.argv[sys.argv.index("--") + 1])
entries = []
bpy.context.preferences.edit.use_global_undo = False
materials = {}
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for folder in sorted(workspace.iterdir()):
    catalog = json.loads((folder / "catalog.json").read_text(encoding="utf-8"))
    entry = catalog["items"][0]
    with bpy.data.libraries.load(str(folder / catalog["library"]), link=False) as (source, target):
        target.collections = [entry["collection"]]
    collection = target.collections[0]
    for obj in collection.all_objects:
        for slot in obj.material_slots:
            material = slot.material
            key = re.sub(r"\.\d{3}$", "", material.name)
            if key in materials:
                slot.material = materials[key]
            else:
                materials[key] = material
    for material in list(bpy.data.materials):
        if material.users == 0:
            bpy.data.materials.remove(material)
    for image in list(bpy.data.images):
        if image.users == 0:
            bpy.data.images.remove(image)
    bpy.context.scene.collection.children.link(collection)
    i = len(entries)
    collection.objects[0].location = ((i % 4) * 3.2, (i // 4) * 3.2, 0)
    entries.append(entry)
    print("MERGED", entry["kind"], flush=True)
output = root / "assets/furniture"
path = output / "habitat-furniture.blend"
bpy.context.scene.unit_settings.system = "METRIC"
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(path))
catalog.update(items=entries, sha256=hashlib.sha256(path.read_bytes()).hexdigest())
(output / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
print("ASSET_LIBRARY_COMPLETE", len(entries), flush=True)
