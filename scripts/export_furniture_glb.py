"""One-time asset migration: export each authored furniture collection to GLB.

Run inside Blender with: blender --background --python scripts/export_furniture_glb.py
The generated GLBs are the runtime furniture library; Blender is not needed for jobs.
"""

import json
from pathlib import Path

import bpy

root = Path(__file__).resolve().parents[1]
assets = root / "assets" / "furniture"
catalog = json.loads((assets / "catalog.json").read_text(encoding="utf-8"))
source = assets / catalog["library"]
output = assets / "glb"
output.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(source))

for entry in catalog["items"]:
    if entry.get("generator") == "python":
        continue
    collection = bpy.data.collections.get(entry["collection"])
    objects = list(collection.all_objects) if collection else []
    if len(objects) != 1 or objects[0].type != "MESH":
        raise RuntimeError(f"Invalid furniture collection: {entry['collection']}")
    bpy.ops.object.select_all(action="DESELECT")
    obj = objects[0]
    old_location = obj.location.copy()
    old_rotation = obj.rotation_euler.copy()
    old_scale = obj.scale.copy()
    obj.location = (0, 0, 0)
    obj.rotation_euler = (0, 0, 0)
    obj.scale = (1, 1, 1)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=str(output / f"{entry['kind']}.glb"),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_extras=True,
        use_selection=True,
    )
    obj.location = old_location
    obj.rotation_euler = old_rotation
    obj.scale = old_scale
    print("EXPORTED", entry["kind"], flush=True)
