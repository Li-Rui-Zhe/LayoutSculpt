"""从固定目录追加已烘焙的家具网格，不接受模型给出的路径或脚本。"""

import hashlib
import json
import math
from pathlib import Path

import bpy


class FurnitureLibrary:
    def __init__(self, catalog_path, mats):
        self.root = Path(catalog_path).resolve().parent
        self.catalog = json.loads(Path(catalog_path).read_text(encoding="utf-8"))
        path = (self.root / self.catalog["library"]).resolve()
        if not path.is_relative_to(self.root) or path.suffix != ".blend":
            raise ValueError("家具库路径必须是资产目录内的 .blend 文件")
        self.digest = hashlib.sha256(path.read_bytes()).hexdigest()
        self.items = {item["kind"]: item for item in self.catalog["items"]}
        self.templates = {}
        self.mats = mats
        self.path = path
        self.instances = []

    def place(self, item):
        entry = self.items.get(item["kind"])
        if not entry:
            return False
        if entry["kind"] not in self.templates:
            with bpy.data.libraries.load(str(self.path), link=False) as (
                source,
                target,
            ):
                if entry["collection"] not in source.collections:
                    raise ValueError(f"家具集合缺失：{entry['collection']}")
                target.collections = [entry["collection"]]
            objects = list(target.collections[0].all_objects)
            if len(objects) != 1 or objects[0].type != "MESH":
                raise ValueError(f"家具 {entry['id']} 必须是已烘焙的单网格集合")
            template = objects[0]
            for slot in template.material_slots:
                role = slot.material.get("asset_role") if slot.material else None
                if role in self.mats:
                    slot.material = self.mats[role]
            self.templates[entry["kind"]] = template
        obj = self.templates[entry["kind"]].copy()
        bpy.context.collection.objects.link(obj)
        obj.name = f"家具_{item['room_id']}_{entry['id']}_{len(self.instances) + 1}"
        obj.location = (item["x"], -item["y"], 0.035)
        obj.rotation_euler = (0, 0, -math.radians(item["rotation"]))
        obj.scale = tuple(
            item[key] / entry["dimensions"][i]
            for i, key in enumerate(["width", "depth", "height"])
        )
        obj["room_id"] = item["room_id"]
        obj["asset_id"] = entry["id"]
        self.instances.append(
            {
                "asset_id": entry["id"],
                "kind": item["kind"],
                "room_id": item["room_id"],
                "dimensions": [item["width"], item["depth"], item["height"]],
            }
        )
        return True

    def report(self):
        return {
            "version": self.catalog["version"],
            "sha256": self.digest,
            "instances": self.instances,
            "matched": len(self.instances),
        }
