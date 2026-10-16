"""AI 失败分类。诊断只保存白名单字段，不暴露上游响应、地址或凭据。"""

import re


def classify_ai_error(error):
    raw = getattr(error, "detail", error)
    info = raw.get("codexErrorInfo") if isinstance(raw, dict) else None
    status = None
    kind = info if isinstance(info, str) else None
    if isinstance(info, dict) and info:
        kind, detail = next(iter(info.items()))
        if isinstance(detail, dict):
            status = detail.get("httpStatusCode")
    message = str(raw).casefold()
    if status is None:
        match = re.search(r"\b(400|401|403|429|500|502|503|504)\b", message)
        status = int(match.group(1)) if match else None
    if (
        kind == "unauthorized"
        or status in (401, 403)
        or any(
            s in message
            for s in (
                "unauthorized",
                "authentication",
                "未登录",
                "permission denied",
                "api key",
            )
        )
    ):
        code = "authentication"
    elif any(
        s in message for s in ("not supported", "unsupported", "不支持模型", "所选模型")
    ):
        code = "model_unavailable"
    elif kind in ("usageLimitExceeded", "sessionBudgetExceeded"):
        code = "quota_exceeded"
    elif (
        kind == "rateLimitExceeded"
        or status == 429
        or "rate limit" in message
        or "rate_limit" in message
    ):
        code = "rate_limited"
    elif kind == "contextWindowExceeded":
        code = "context_exceeded"
    elif "schema" in message and any(s in message for s in ("invalid", "400")):
        code = "invalid_contract"
    elif kind == "badRequest" or status == 400:
        code = "invalid_request"
    elif (
        "empty response" in message
        or "0 tokens" in message
        or "未返回结构化结果" in message
    ):
        code = "empty_response"
    elif kind in ("serverOverloaded", "internalServerError") or status in (
        500,
        502,
        503,
        504,
    ):
        code = "service_unavailable"
    elif (
        kind
        in (
            "httpConnectionFailed",
            "responseStreamConnectionFailed",
            "responseStreamDisconnected",
            "responseTooManyFailedAttempts",
        )
        or any(
            s in message
            for s in (
                "connection reset",
                "connection closed",
                "connection aborted",
                "stream disconnected",
                "temporarily unavailable",
                "internal server error",
                "server overloaded",
                "codex 服务意外退出",
                "codex 服务连接已关闭",
                "codex 进程未运行",
                "codex 连接中断",
            )
        )
        or isinstance(error, ConnectionError)
    ):
        code = "connection_lost"
    elif isinstance(error, TimeoutError):
        code = "timeout"
    else:
        code = "unknown"
    result = {
        "code": code,
        "retryable": code
        in {
            "empty_response",
            "rate_limited",
            "service_unavailable",
            "connection_lost",
            "timeout",
        },
    }
    if isinstance(status, int) and 100 <= status <= 599:
        result["http_status"] = status
    return result


MESSAGES = {
    "empty_response": "AI 未返回有效结果，本次无法继续。请稍后重试；若持续出现，请检查本地 AI 服务的模型响应。",
    "rate_limited": "AI 服务请求受限，请稍后重试。",
    "quota_exceeded": "AI 服务额度不足，请检查当前账号额度后重试。",
    "authentication": "AI 服务登录或访问权限失效，请检查本地服务登录状态后重试。",
    "model_unavailable": "当前所选模型不可用，请刷新模型列表并重新选择。",
    "context_exceeded": "本次输入超出模型处理范围，请精简附加要求或选择支持更长上下文的模型。",
    "invalid_contract": "AI 服务未接受当前结构化输出格式，请检查模型与本地服务的兼容性。",
    "invalid_request": "AI 服务未接受本次请求，请检查模型设置与本地服务配置。",
    "service_unavailable": "AI 服务暂时不可用，请稍后重试。",
    "connection_lost": "AI 连接中断，未取得完整结果，请稍后重试。",
    "timeout": "AI 未在等待上限内完成，请稍后重试，或调整推理强度。",
    "invalid_result": "AI 返回的结构未通过校验，自动修正后仍有问题。请重试；若原图模糊，可补充更清晰的户型图。",
}


def ai_failure_message(error, stage):
    from langchain_core.exceptions import OutputParserException
    from pydantic import ValidationError

    code = classify_ai_error(error)["code"]
    if isinstance(error, (OutputParserException, ValidationError)):
        code = "invalid_result"
    message = MESSAGES.get(code)
    if message:
        outcome = "超时" if code == "timeout" else "未完成"
        return f"{stage}{outcome}：{message}原图和已完成步骤已保留。"
    return None
