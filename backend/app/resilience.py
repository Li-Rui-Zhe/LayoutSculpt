"""Bounded recovery for temporary AI transport failures, never model substitution."""

import re

from .codex import CodexError


def transient_ai_error(error):
    if isinstance(error, ConnectionError):
        return True
    if not isinstance(error, CodexError):
        return False
    message = str(error).casefold()
    if any(term in message for term in (
        "not supported", "unsupported", "invalid schema", "invalid_json_schema",
        "unauthorized", "authentication", "api key", "permission denied",
        "原图", "结构版本", "所选模型", "不支持", "未登录",
    )) or re.search(r"\b(?:400|401|403)\b", message):
        return False
    return bool(any(term in message for term in (
        "本地 codex 服务意外退出", "codex 服务连接已关闭", "codex 进程未运行",
        "connection reset", "connection closed", "connection aborted",
        "stream disconnected", "temporarily unavailable", "internal server error",
        "rate limit", "rate_limit", "server overloaded",
    )) or re.search(r"\b(?:429|502|503|504)\b", message))
