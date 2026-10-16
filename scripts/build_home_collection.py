"""离线生成家庭家具系列；先验证全部产物，再更新官方目录。无需在线服务。"""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.home_collection import SPECS, LEGACY, VERSION, construct
from backend.app.library_models import load_glb
from scripts.render_asset_thumbnails import render

FAMILY_BY_KIND = {
    **dict.fromkeys(["coffee_table", "coffee_round", "coffee_nested"], "茶几"),
    **dict.fromkeys(["side_table", "side_c_table"], "边几"),
    **dict.fromkeys(["nightstand", "nightstand_slim"], "床头柜"),
    **dict.fromkeys(["washing_machine", "laundry_tower"], "洗衣机"),
    **dict.fromkeys(["shoe_cabinet", "entry_tall"], "鞋柜"),
    "chest_drawers": "斗柜",
    "cleaning_cabinet": "家政柜",
    "utility_sink": "洗衣柜",
    "drying_rack": "晾衣架",
    "coat_rack": "衣帽架",
    "floor_mirror": "穿衣镜",
    "plant": "绿植",
    "rug": "地毯",
    "bench": "换鞋凳",
    "entry_console": "玄关台",
    "dishwasher": "洗碗机",
    "oven": "烤箱",
    "bar_stool": "吧椅",
    "dining_bench": "餐凳",
    "kids_table": "儿童桌",
    "kids_chair": "儿童椅",
    "balcony_table": "户外桌",
    "balcony_chair": "户外椅",
    "ottoman": "脚凳",
}


def enrich(entry, room, family, variant, role="oak"):
    family = FAMILY_BY_KIND.get(entry["kind"], family)
    entry.update(
        category=room,
        family=family,
        variant=variant,
        style={
            "walnut": "胡桃木质",
            "cream": "奶油简约",
            "steel": "现代简约",
            "charcoal": "现代简约",
            "sage": "自然清新",
        }.get(role, "原木自然"),
        tags=[room, family, variant],
        rooms=[room],
    )
    if family in {"床", "衣柜"} and room == "儿童房":
        entry["rooms"].append("卧室")
    if family == "休闲座椅":
        entry["rooms"].append("卧室")
    entry["description"] = (
        f"{variant}，适合{room}空间。尺寸为模型整体外廓的宽 × 深 × 高，可在人工设计中调整。"
    )
    details = {
        "crib": "四面通透圆杆围栏、暖白框架与浅木扶手，床内仅保留贴合床垫。",
        "bed_bunk": "上下独立床垫、侧面梯口、宽踏板与圆角护栏。",
        "side_c_table": "薄木圆角桌面与开口钢管底架，可用于沙发侧边。",
        "balcony_table": "薄边圆桌面、三点外撇木腿与连接撑。",
        "drying_rack": "水平主晾晒架、两侧折叠翼、交叉铰链与防滑脚套；不含折叠动画。",
        "coffee_table": "圆角岩板桌面、内收置物层与四点实木支撑。",
    }
    if entry["kind"] in details:
        entry["description"] += details[entry["kind"]]
    if family == "床":
        entry["description"] += "床体尺寸不等同于床垫采购规格。"
    if room == "儿童房":
        entry["description"] += "用于空间布局展示，护栏、间距及承重需以实物产品为准。"
    if entry["kind"] == "floor_mirror":
        entry["description"] += "镜面为材质近似，实时预览不提供真实镜像反射。"
    if "贵妃" in variant:
        entry["description"] += "左右以面对沙发时为准。"
    if entry["kind"] == "desk_standing":
        entry["description"] += "当前展示为坐姿高度，不含升降动画。"
    if entry["kind"] == "sofa_daybed":
        entry["description"] += "固定日床造型，不含展开动画。"
    return entry


def build(only=None, metadata_only=False):
    folder = ROOT / "assets/furniture"
    catalog = json.loads((folder / "catalog.json").read_text(encoding="utf-8"))
    existing = {entry["kind"]: entry for entry in catalog["items"]}
    selected = [s for s in SPECS if not only or s[0] in only]
    if only and set(only) - {s[0] for s in selected}:
        raise ValueError("未知的家具编号")
    if metadata_only:
        selected = []
    with tempfile.TemporaryDirectory(prefix="home-collection-") as temp:
        stage = Path(temp)
        for spec in selected:
            key, name, base, room, family, variant, dimensions, shape, role = spec
            scene = construct(spec)
            payload = scene.export(file_type="glb")
            check = load_glb(payload)
            if not np.allclose(
                check.extents, np.array(dimensions)[[0, 2, 1]], atol=1e-5
            ):
                raise ValueError(f"{key}尺寸不一致")
            if not np.isfinite(check.bounds).all() or abs(check.bounds[0, 1]) > 1e-5:
                raise ValueError(f"{key}未正确落地")
            triangles = sum(len(mesh.faces) for mesh in check.geometry.values())
            if triangles > 100_000 or len(payload) > 8 * 1024 * 1024:
                raise ValueError(f"{key}资源超限")
            (stage / f"{key}.glb").write_bytes(payload)
            render(stage / f"{key}.glb", stage / f"{key}.png")
            existing[key] = enrich(
                dict(
                    id=f"habitat_{key}",
                    kind=key,
                    furniture_kind=base,
                    name=name,
                    dimensions=list(dimensions),
                    revision=VERSION,
                    generator="python",
                    source="tools/home_collection.py",
                    format="glb",
                    triangles=triangles,
                    sha256=hashlib.sha256(payload).hexdigest(),
                ),
                room,
                family,
                variant,
                role,
            )
            print(f"完成 {key}: {triangles} 面 / {len(payload) // 1024} KB", flush=True)
        for key, name, base, room, family, variant, dimensions, shape, role in SPECS:
            if key in existing:
                enrich(existing[key], room, family, variant, role)
        for key, (room, family, variant) in LEGACY.items():
            if key in existing:
                role = (
                    "steel"
                    if room in {"厨房", "卫浴", "阳台"}
                    and key != "counter"
                    or family == "电视"
                    else "sage"
                    if key == "plant"
                    else "oak"
                )
                enrich(existing[key], room, family, variant, role)
        for spec in selected:
            key = spec[0]
            for suffix, dest in [("glb", "glb"), ("png", "thumbnails")]:
                shutil.copyfile(
                    stage / f"{key}.{suffix}", folder / dest / f"{key}.{suffix}"
                )
        catalog.update(
            version=VERSION,
            items=sorted(existing.values(), key=lambda e: e["kind"]),
            collection_source="tools/home_collection.py",
            source_note="Blender 源工程保留早期系列；3.0 家庭系列由 tools/home_collection.py 生成，以各项 source 与 generator 为准。",
        )
        pending = folder / "catalog.json.tmp"
        pending.write_text(
            json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        pending.replace(folder / "catalog.json")
    print(f"官方库共 {len(existing)} 款家具", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="+")
    parser.add_argument("--metadata-only", action="store_true")
    args = parser.parse_args()
    build(args.only, args.metadata_only)
