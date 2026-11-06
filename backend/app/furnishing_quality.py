"""生成专用的实物比例、安装依附与功能检查；不作用于人工编辑。"""

import itertools
import math
from statistics import median

from shapely.geometry import LineString, Polygon

from .placement_geometry import walls_at_height


def normalize_catalog_sizes(plan, assets):
    result = plan.model_copy(deep=True)
    notes = []
    for item in result.items:
        asset = assets.get(item.asset_id, {})
        size = asset.get("dimensions")
        if not size:
            continue
        ratios = [
            getattr(item, field) / expected
            for field, expected in zip(("width", "depth", "height"), size)
        ]
        # 小幅等比调整允许表现相近型号；禁止把宽柜压成窄柜或床垫拉成薄片。
        scale = min(1.05, max(0.95, median(ratios)))
        if max(ratios) - min(ratios) > 0.08 or min(ratios) < 0.9 or max(ratios) > 1.1:
            scale = 1.0
        scale = min(scale, 6 / size[0], 6 / size[1], 3 / size[2])
        scale = max(scale, .1 / size[0], .1 / size[1], .02 / size[2])
        if any(abs(ratio - scale) > 0.005 for ratio in ratios):
            for field, value in zip(("width", "depth", "height"), size):
                setattr(item, field, round(value * scale, 6))
            notes.append(
                f"{item.name or asset.get('name', item.kind)}已按素材比例校正尺寸"
            )
        surface = asset.get("placement_surface")
        item.placement_surface = surface
        if surface == "wall" and item.elevation < 0.3:
            item.elevation = asset.get("default_elevation", 1.5)
            notes.append(f"{item.name or item.kind}已调整到壁挂安装高度")
        elif (
            surface == "floor"
            and item.elevation > 0.05
            and item.kind not in {"wall_television"}
        ):
            item.elevation = 0
            notes.append(f"{item.name or item.kind}已落地")
    result.notes = list(dict.fromkeys([*notes, *result.notes]))[:20]
    return result


def mounted_on_wall(item, layout):
    """背面全宽与高度范围都有实墙，不能把电器挂在窗或门上。"""
    # 玻璃隔断与玻璃栏板不是可靠的壁挂安装面；矮墙只保留实体基座部分。
    layout = layout.model_copy(update={"walls": [
        w.model_copy(update={"height": w.sill_height})
        if w.boundary_type in {"glazing", "glass_railing"} else w
        for w in layout.walls
        if w.boundary_type not in {"glazing", "glass_railing"} or w.sill_height > 0
    ]})
    angle = math.radians(item.rotation)
    c, s = math.cos(angle), math.sin(angle)
    # walls_at_height 返回此高度范围的实体并集；再逐层验证，防止窗楣替代整片安装面。
    low, high = item.elevation, item.elevation + item.height
    cuts = sorted(
        {
            low,
            high,
            *[
                v
                for opening in layout.openings
                for v in (opening.bottom, opening.bottom + opening.height)
                if low < v < high
            ],
            *[w.height for w in layout.walls if low < w.height < high],
        }
    )
    back = LineString(
        [
            (item.x + dx * c + item.depth / 2 * s, item.y + dx * s - item.depth / 2 * c)
            for dx in (-item.width * 0.45, item.width * 0.45)
        ]
    )
    for bottom, top in itertools.pairwise(cuts):
        level = (bottom + top) / 2
        support = walls_at_height(layout, level, level + 0.0001)
        if not support.buffer(0.15).covers(back):
            return False
    return True


def attach_countertop_items(plan, assets, fixed_items=()):
    """只在已有台面确实支撑设备时校准离地，不凭空添加桌柜。"""
    from .quality import footprint

    for item in plan.items:
        if assets.get(item.asset_id, {}).get("placement_surface") != "countertop":
            continue
        shape = footprint(item)
        supports = [
            other
            for other in [*fixed_items, *plan.items]
            if other is not item
            and other.room_id == item.room_id
            and other.kind in {"desk", "table", "counter", "tv_console", "cabinet"}
            and 0.45 <= other.elevation + other.height <= 1.25
            and footprint(other).buffer(0.015).covers(shape)
        ]
        if supports:
            support = min(
                supports,
                key=lambda other: abs(other.elevation + other.height - item.elevation),
            )
            item.elevation = round(support.elevation + support.height, 6)


def functional_gaps(layout, plan):
    """只检查明确房间的核心用途；小房间不强塞配件。"""
    rules = {
        "bedroom": ({"bed"}, "床"),
        "living": ({"sofa", "armchair"}, "座椅"),
        "kitchen": ({"counter"}, "厨房操作台"),
        "bathroom": ({"toilet"}, "坐便器"),
        "study": ({"desk", "table"}, "书桌"),
    }
    gaps = []
    for room in layout.rooms:
        if (
            room.kind not in rules
            or Polygon([(p.x, p.y) for p in room.polygon]).area < 2
        ):
            continue
        kinds, label = rules[room.kind]
        if not any(
            item.room_id == room.id and item.kind in kinds for item in plan.items
        ):
            gaps.append(
                {
                    "room_id": room.id,
                    "need": label,
                    "kinds": sorted(kinds),
                    "message": f"{room.name}尚缺{label}，需要检查可用空间",
                }
            )
    return gaps
