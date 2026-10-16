"""Bounded recovery for temporary AI transport failures, never model substitution."""

from .ai_failures import classify_ai_error
from .codex import CodexError


def transient_ai_error(error):
    if isinstance(error, ConnectionError):
        return True
    if not isinstance(error, CodexError):
        return False
    return classify_ai_error(error)["retryable"]
