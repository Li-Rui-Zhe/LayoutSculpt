"""尺寸依据展示；用户记录不等于系统验证现场尺寸。"""

import math


def dimension_label(data):
    basis = data.get("dimension_basis") or {}
    anchors = basis.get("anchors") or []
    if basis.get("source") == "user_reference" and anchors:
        walls = {w["id"]: w for w in data.get("walls", [])}
        for anchor in anchors:
            wall = walls.get(anchor["wall_id"])
            if (
                not wall
                or abs(
                    math.hypot(
                        wall["end"]["x"] - wall["start"]["x"],
                        wall["end"]["y"] - wall["start"]["y"],
                    )
                    / anchor["meters"]
                    - 1
                )
                > 0.02
            ):
                return "参考墙已变化，请重新校准"
        source = "用户实测" if all(a["source"] == "measured" for a in anchors) else "图纸"
        return f"已按{source}参考长度校准；其他墙段、净空和高度仍需核实"
    if basis.get("source") == "image_dimensions":
        return (
            "图上尺寸比例不一致，待核对"
            if basis.get("inconsistent")
            else "AI 读取图上标注换算，未实测"
        )
    if basis.get("source") == "estimated":
        return "尺寸估算，尚未校准"
    return "尺寸依据待核实"


def furniture_size_label(item):
    ref = item.get("size_reference")
    if not ref:
        return "模型尺寸，未核对商品"
    if any(abs(item[k] - ref[k]) > 0.00001 for k in ("width", "depth", "height")):
        return "尺寸已改动，请重新核对"
    return "用户录入实测尺寸" if ref["source"] == "measured" else "用户录入商品尺寸"
