"""程序筛选本次家具候选，不增加 AI 阶段，也不改变用户素材文件。"""

import json
import math
from collections import defaultdict
from pathlib import Path

PRESETS = json.loads(
    (
        Path(__file__).resolve().parents[2] / "assets/furniture/style-presets.json"
    ).read_text(encoding="utf-8")
)
ROOM_CATEGORIES = {
    "living": {"客厅", "餐厅", "玄关", "书房"},
    "dining": {"餐厅", "客厅", "厨房"},
    "bedroom": {"卧室", "儿童房", "书房"},
    "study": {"书房", "客厅"},
    "kitchen": {"厨房", "餐厅", "阳台"},
    "bathroom": {"卫浴", "阳台"},
    "balcony": {"阳台"},
    "hall": {"玄关", "客厅"},
}
# 使用相同 kind 的结构款仍保留独立候选，如婴儿床和上下床不能被普通床替代。
STRUCTURAL_VARIANTS = {
    "crib",
    "bed_bunk",
    "sofa_chaise_left",
    "sofa_chaise_right",
    "laundry_tower",
}


def asset_styles(item):
    explicit = item.get("styles")
    if isinstance(explicit, list):
        known = [s for s in explicit if s in PRESETS["styles"]]
        if known:
            return list(dict.fromkeys(known))
    key = item.get("catalog_kind")
    if key in PRESETS["model_styles"]:
        return PRESETS["model_styles"][key]
    if item.get("family") in PRESETS["shared_families"]:
        return list(PRESETS["styles"])
    return [
        key
        for key, profile in PRESETS["styles"].items()
        if item.get("style") in profile["labels"]
    ]


def dimensions(item):
    size = item.get("dimensions")
    if (
        not isinstance(size, (list, tuple))
        or len(size) != 3
        or any(
            not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0
            for v in size
        )
    ):
        return None
    # 与可编辑家具契约一致，避免把不可表示的巨大模型发给 AI 后再强行压缩。
    if not (.1 <= size[0] <= 6 and .1 <= size[1] <= 6 and .02 <= size[2] <= 3):
        return None
    return size


def select_candidates(items, layout, style="natural", notes="", *, per_family=3):
    """风格仅排序；小尺寸和点名款保留，不能按风格丢失必要的家具用途。"""
    rooms = layout.rooms
    categories = {"装饰"}
    broad = not rooms or any(room.kind == "other" for room in rooms)
    for room in rooms:
        categories.update(ROOM_CATEGORIES.get(room.kind, set()))
        categories.update(
            label
            for labels in ROOM_CATEGORIES.values()
            for label in labels
            if label in room.name
        )
    bounds = []
    for room in rooms:
        xs, ys = [p.x for p in room.polygon], [p.y for p in room.polygon]
        bounds.append((max(xs) - min(xs), max(ys) - min(ys)))
    groups, requested, seen = defaultdict(list), [], set()
    for original in items:
        identity = original.get("asset_id") or original.get("kind")
        if not identity or identity in seen or original.get("archived"):
            continue
        size = dimensions(original)
        if not size:
            continue
        seen.add(identity)
        item = {**original, "styles": asset_styles(original)}
        named = any(
            isinstance(term, str) and len(term) >= 3 and term in notes
            for term in [
                item.get("name"),
                item.get("variant"),
                item.get("catalog_kind"),
            ]
        )
        # 点名和主动启用的个人素材不能因风格或空间标签被丢掉。
        pinned = named or item.get("source") in {"diy", "imported"}
        if pinned:
            requested.append(item)
        regions = set(item.get("rooms") or [item.get("category")]) - {None, ""}
        requested_use = any(
            isinstance(term, str) and len(term) >= 2 and term in notes
            for term in [item.get("family"), item.get("category")]
        )
        if (
            not pinned
            and not requested_use
            and not broad
            and regions
            and not regions.intersection(categories)
        ):
            continue
        w, d, _ = size
        fits = not bounds or any(
            (w <= a and d <= b) or (d <= a and w <= b) for a, b in bounds
        )
        family = item.get("family") or item.get("kind")
        structural = item.get("catalog_kind")
        purpose = structural if structural in STRUCTURAL_VARIANTS else ""
        if item.get("kind") == "bed" and not purpose:
            # 儿童/单人床不能挤掉成人双人床候选；占地最小不等于用途可替代。
            purpose = "double_bed" if w >= 1.35 else "single_bed"
        group = (
            item.get("kind"),
            family,
            purpose,
        )
        groups[group].append(
            (not fits, style not in item["styles"], item.get("quality_tier") != "detailed", w * d, str(identity), item)
        )
    selected = {item.get("asset_id") or item["kind"]: item for item in requested}
    for variants in groups.values():
        variants.sort(key=lambda v: v[:5])
        choices = variants[: max(1, per_family - 1)]
        if style == "custom":
            # 自定义描述由同一次家具规划 AI 理解，先保留不同基调的代表款。
            choices = []
            for compatible in PRESETS["styles"]:
                representative = next(
                    (v for v in variants if compatible in v[-1]["styles"]), None
                )
                if representative is not None and representative not in choices:
                    choices.append(representative)
            if len(choices) < 2:
                choices.extend(v for v in variants[:2] if v not in choices)
        # 风格最接近的两款之外，至少提供一款占地较小的备选。
        smallest = min(variants, key=lambda v: (v[0], v[3], v[4]))
        for row in [*choices, smallest]:
            item = row[-1]
            selected[item.get("asset_id") or item["kind"]] = item
    return [selected[key] for key in sorted(selected)]
