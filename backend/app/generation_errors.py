"""面向用户的生成表单校验提示，不返回校验库内部信息。"""

from .public_errors import public_message

LABELS = {
    "name": "任务名称",
    "file": "户型图片",
    "style": "空间风格",
    "style_description": "自定义风格描述",
    "notes": "设计要求",
    "model": "生成模型",
    "reasoning_effort": "推理强度",
    "furniture_mode": "家具方案",
    "wall_material": "墙面材质",
    "floor_material": "地板材质",
    "collaboration": "AI 结构复核设置",
}


def generation_validation_message(errors):
    messages = []
    for error in errors:
        field = next((p for p in error.get("loc", ()) if p in LABELS), None)
        label = LABELS.get(field, "生成参数")
        kind = error.get("type", "")
        if kind == "string_too_long":
            message = f"{label}最多填写 {error['ctx']['max_length']} 个字符"
        elif kind == "missing":
            message = f"请提供{label}"
        elif (
            kind == "value_error"
            and error.get("msg") == "Value error, 请填写自定义空间风格"
        ):
            message = "请填写自定义空间风格"
        elif kind == "literal_error":
            message = f"{label}选项无效，请重新选择"
        elif kind == "value_error":
            message = public_message(error.get("msg", "").removeprefix("Value error, "), f"{label}格式不正确，请检查后重试")
        else:
            message = f"{label}格式不正确，请检查后重试"
        if message not in messages:
            messages.append(message)
    return "；".join(messages) or "生成参数不正确，请检查后重试"
