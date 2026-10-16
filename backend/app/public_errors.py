"""在 HTTP 和后台任务边界隐藏上游响应、凭据与本机路径。"""

import re

from pydantic import ValidationError


def public_message(error, fallback="操作未完成，请稍后重试；当前设计已保留。"):
    if isinstance(error, ValidationError):
        return "提交的参数不符合要求，请检查尺寸、位置和材质设置后重试。"
    text = str(error)
    if (
        not re.search(r"[\u4e00-\u9fff]", text)
        or len(text) > 600
        or re.search(
            r"https?://|[A-Za-z]:[\\/]|/(?:Users|home|tmp|var)/|sk-[\w-]+|Bearer\s|api[_-]?key|authorization|Traceback|input_value=|sub2api",
            text,
            re.IGNORECASE,
        )
    ):
        return fallback
    return text
