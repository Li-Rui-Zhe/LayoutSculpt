"""Count delivered emitters from the GLB JSON without loading mesh buffers."""
import json
import struct


def model_lighting_summary(path, editable_ids=()):
    with open(path, "rb") as source:
        header = source.read(20)
        if len(header) != 20:
            raise ValueError("模型缺少 GLB 索引")
        magic, version, total, length, kind = struct.unpack("<4sIIII", header)
        if magic != b"glTF" or version != 2 or kind != 0x4E4F534A or not 0 < length <= 4 * 1024 * 1024 or length + 20 > total:
            raise ValueError("模型 GLB 索引无效")
        tree = json.loads(source.read(length))
    emitters = {}
    for node in tree.get("nodes", []):
        meta = node.get("extras", {})
        if meta.get("fixture_id") and "fixture_lumens" in meta:
            emitters[meta["fixture_id"]] = meta
    editable = set(editable_ids) & emitters.keys()
    return {
        "light_count": len(emitters),
        "editable_light_count": len(editable),
        "decorative_light_count": len(emitters) - len(editable),
        "active_light_count": sum(m.get("fixture_enabled", True) and m["fixture_lumens"] > 0
                                  for m in emitters.values()),
    }
