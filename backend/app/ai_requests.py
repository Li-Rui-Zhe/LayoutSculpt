"""面向 AI 的阶段输入；内部设计数据与保存格式保持完整。"""

from .ai_contracts import LayoutExtraction, LayoutReviewPatch, pack_layout
from .recognition_contract import RecognitionRoom


def review_schema():
    schema = LayoutReviewPatch.model_json_schema()
    schema["$defs"]["RoomWire"] = RecognitionRoom.model_json_schema()
    return schema


def layout_input(layout):
    # 只省略契约已有的默认值；不截断坐标、不删墙、不改用户设置。
    return LayoutExtraction.model_validate(pack_layout(layout)).model_dump(
        exclude_defaults=True
    )


def furnishing_schema(output_type, *, library, surface_catalog=None):
    schema = output_type.model_json_schema()
    furniture = schema["$defs"]["Furniture"]
    omitted = {"edit_id", "edit_locked", "edit_hidden", "edit_group", "source_asset_id", "asset_family"}
    if library:
        # 目录中的 DIY 通过 asset_id 选择，后端加载原始部件，无需 AI 重写。
        omitted.add("diy")
        furniture["properties"]["kind"]["enum"].remove("custom")
        schema["$defs"].pop("DiyDesign", None)
        schema["$defs"].pop("DiyPart", None)
    for key in omitted:
        furniture["properties"].pop(key, None)
    furniture["required"] = [
        key for key in furniture.get("required", []) if key not in omitted
    ]
    if surface_catalog:
        for field, category in (
            ("wall_material", "walls"),
            ("floor_material", "floor"),
        ):
            if field in schema["properties"]:
                # 本次可选编号就是完整取值范围；避免让服务推导同类型 anyOf + 正则分支。
                identifiers = list(
                    dict.fromkeys(item["id"] for item in surface_catalog[category])
                )
                if not identifiers:
                    raise ValueError("本次设计缺少可用的墙面或地板材质")
                schema["properties"][field] = {"type": "string", "enum": identifiers}
    return schema


def asset_input(items):
    # 保留每件可选素材及其用途/变体，不将预览描述、更新时间等管理信息发送给模型。
    keys = (
        "asset_id",
        "name",
        "kind",
        "dimensions",
        "category",
        "family",
        "variant",
        "style",
        "styles",
        "rooms",
        "default_elevation",
    )
    return [
        {key: item[key] for key in keys if item.get(key) is not None} for item in items
    ]
