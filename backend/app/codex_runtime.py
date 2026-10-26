"""Bounded, non-inference diagnostics for the installed Codex CLI."""

import asyncio
import json
import os
import platform
import re
import subprocess
import time
from datetime import datetime, timezone

import httpx

from .ai_credentials import atomic_private_write
from .ai_failures import classify_ai_error
from .codex import CodexError, codex_command_args, codex_command_signature
from .network import codex_environment, windows_system_proxies
from .toolchain_paths import architecture_label

VERSION = re.compile(r"^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([a-zA-Z0-9.-]+))?$")
RELEASE_URL = "https://registry.npmjs.org/@openai%2fcodex/latest"
CLI_DOCS = "https://developers.openai.com/codex/cli"


def now():
    return datetime.now(timezone.utc).isoformat()


def newer_version(latest, current):
    a, b = VERSION.fullmatch(latest or ""), VERSION.fullmatch(current or "")
    if not a or not b or a[4]:
        return None
    aa, bb = tuple(map(int, a.groups()[:3])), tuple(map(int, b.groups()[:3]))
    return aa > bb or (aa == bb and bool(b[4]))


async def cli_version(command):
    process = None
    try:
        async with asyncio.timeout(6):
            process = await asyncio.create_subprocess_exec(
                *codex_command_args(command),
                "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                env=codex_environment(),
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            output = await process.stdout.read(8193)
            if len(output) > 8192:
                raise CodexError("CLI 版本输出异常，请检查 CODEX_CMD。")
            await process.wait()
            match = re.search(
                r"\bcodex(?:-cli)?\s+(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)\b",
                output.decode(errors="replace"),
            )
            if process.returncode or not match:
                raise CodexError("无法识别 CLI 版本，请确认 CODEX_CMD 指向 Codex CLI。")
            return match[1]
    finally:
        if process and process.returncode is None:
            process.kill()
            await process.wait()


def failure(error):
    """Only return curated messages, never CLI stderr/config/account objects."""
    code = classify_ai_error(error)["code"]
    text = str(error).casefold()
    if "正在处理任务" in text:
        return "busy", "本机 Codex 正在处理任务，请等待任务结束后再重连。", "wait"
    if isinstance(error, FileNotFoundError):
        return (
            "not_installed",
            "未找到可执行的 Codex CLI，请安装后重新检测。",
            "install",
        )
    if isinstance(error, PermissionError):
        return (
            "permission",
            "Codex CLI 无法执行，请检查文件权限或 CODEX_CMD。",
            "configure",
        )
    if code == "authentication":
        return (
            code,
            "本机 Codex 尚未登录或登录已失效，请执行 codex login 后重新检测。",
            "login",
        )
    if isinstance(error, TimeoutError) or "timeout" in text:
        return "timeout", "检测超时，请检查网络与代理，稍后重新检测。", "retry"
    if any(
        s in text
        for s in (
            "method not found",
            "unknown variant",
            "unexpected argument",
            "-32601",
            "版本输出",
            "识别 cli",
            "返回格式",
        )
    ):
        return (
            "incompatible",
            "当前 CLI 未通过协议检测，请检查版本和 CODEX_CMD，升级后安全重连。",
            "upgrade",
        )
    if code in {"connection_lost", "service_unavailable", "rate_limited"}:
        return (
            code,
            "CLI 连接暂时不可用，请稍后重试；持续失败时可安全重连。",
            "reconnect",
        )
    return (
        "check_failed",
        "CLI 检测未通过，请检查本机配置、网络和版本后重新检测。",
        "configure",
    )


class CodexRuntime:
    def __init__(self, settings, local):
        self.settings, self.local = settings, local
        self.lock = asyncio.Lock()
        self.update_lock = asyncio.Lock()
        self.report = None
        self.update = None
        self.update_at = 0
        self.transport = None  # Tests inject HTTP transport, not a user-facing URL.
        self.history_path = settings.data_dir / "ai" / "codex-compatibility.json"
        self.history = None
        try:
            data = json.loads(self.history_path.read_text(encoding="utf-8"))
            if (
                VERSION.fullmatch(data.get("version", ""))
                and data.get("platform") == platform.system()
                and data.get("architecture") == platform.machine()
                and isinstance(data.get("checked_at"), str)
            ):
                self.history = {
                    k: data[k]
                    for k in ("version", "platform", "architecture", "checked_at")
                }
        except (OSError, ValueError, TypeError, AttributeError, KeyError):
            pass

    @property
    def command(self):
        return getattr(self.local, "command", self.settings.codex_command)

    def snapshot(self):
        update = dict(self.update) if self.update else None
        if update and update["status"] == "ok":
            update["available"] = newer_version(
                update["latest_version"], (self.report or {}).get("version")
            )
        report = dict(self.report or {})
        if report.get("status") == "ready" and not self.local.alive:
            report.update(
                status="disconnected",
                action="reconnect",
                code="connection_lost",
                message="上次检测通过的 CLI 连接已断开，请重新检测或安全重连。",
            )
        return {
            **(
                report
                or {
                    "status": "unchecked",
                    "version": None,
                    "checked_at": None,
                    "message": "尚未检测 CLI 版本与连接。",
                    "auth_status": "unknown",
                }
            ),
            "connected": self.local.alive,
            "active_tasks": getattr(self.local, "active_generations", 0),
            "platform": platform.system(),
            "architecture": platform.machine(),
            "architecture_label": architecture_label(platform.machine()),
            "last_verified": self.history,
            "update": update,
            "docs_url": CLI_DOCS,
        }

    async def inspect(self, *, reconnect=False):
        async with self.lock:
            report = {
                "version": None,
                "checked_at": now(),
                "auth_status": "unknown",
                "retry_count": 0,
            }
            catalog = None
            try:
                async with asyncio.timeout(50):
                    report["version"] = await cli_version(self.command)
                    # A disk upgrade does not change an already-running app-server.
                    signature = codex_command_signature(self.command)
                    running = getattr(self.local, "launch_signature", None)
                    if (
                        self.local.alive
                        and running
                        and signature != running
                        and not reconnect
                    ):
                        report.update(
                            status="restart_required",
                            code="version_changed",
                            action="reconnect",
                            message="检测到 CLI 文件已更新，请在任务结束后安全重连，再验证新版本。",
                        )
                        self.report = report
                        return {"diagnostics": self.snapshot(), "catalog": None}
                    if reconnect:
                        if not hasattr(self.local, "reconnect"):
                            raise CodexError("此本机连接不支持安全重连")
                        await self.local.reconnect()
                    for attempt in range(2):
                        try:
                            catalog = await self.local.list_models(refresh=True)
                            break
                        except (CodexError, ConnectionError, OSError) as exc:
                            if attempt or classify_ai_error(exc)["code"] not in {
                                "connection_lost",
                                "service_unavailable",
                            }:
                                raise
                            report["retry_count"] = 1
                            await asyncio.sleep(0.3)
                    if not isinstance(catalog, dict) or not isinstance(
                        catalog.get("items"), list
                    ):
                        raise CodexError("CLI 模型目录返回格式不兼容")
                    selectable = [
                        m for m in catalog["items"] if m.get("available") is not False
                    ]
                    report["auth_status"] = getattr(
                        self.local, "auth_status", "unknown"
                    )
                    if not selectable:
                        report.update(
                            status="no_models",
                            code="model_unavailable",
                            action="configure",
                            message="已连接 CLI，但没有可选择的模型，请检查登录、模型配置和账户权限。",
                        )
                    else:
                        report.update(
                            status="ready",
                            code=None,
                            action=None,
                            model_count=len(selectable),
                            message="CLI 协议与模型目录检测通过；实际推理权限以任务结果为准。",
                        )
                        self.history = {
                            "version": report["version"],
                            "checked_at": report["checked_at"],
                            "platform": platform.system(),
                            "architecture": platform.machine(),
                        }
                        try:
                            atomic_private_write(
                                self.history_path, json.dumps(self.history).encode()
                            )
                        except OSError:
                            report["history_warning"] = (
                                "检测通过，但无法保存版本记录，请检查本地数据目录权限。"
                            )
            except (
                CodexError,
                OSError,
                TimeoutError,
                ConnectionError,
                ValueError,
                KeyError,
                TypeError,
            ) as exc:
                code, message, action = failure(exc)
                # A CLI that rejects startup flags can exit before replying to
                # initialize. Inspect its bounded stderr only for classification.
                if code in {"connection_lost", "check_failed"} and not self.local.alive:
                    hint = "\n".join(getattr(self.local, "stderr", ()))
                    candidate = failure(CodexError(hint))
                    if candidate[0] == "incompatible":
                        code, message, action = candidate
                report.update(
                    status="error",
                    code=code,
                    message=message,
                    action=action,
                    auth_status=getattr(self.local, "auth_status", "unknown"),
                )
                catalog = None
            self.report = report
            return {"diagnostics": self.snapshot(), "catalog": catalog}

    async def check_update(self):
        async with self.update_lock:
            ttl = 600 if self.update and self.update["status"] == "ok" else 60
            if self.update and time.monotonic() - self.update_at < ttl:
                return self.snapshot()
            checked = now()
            try:
                proxy = None
                if self.transport is None and not any(
                    os.getenv(k)
                    for k in ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy")
                ):
                    proxy = windows_system_proxies().get("HTTPS_PROXY")
                async with (
                    asyncio.timeout(10),
                    httpx.AsyncClient(
                        transport=self.transport,
                        proxy=proxy,
                        trust_env=self.transport is None,
                        timeout=8,
                        follow_redirects=False,
                    ) as client,
                    client.stream(
                        "GET", RELEASE_URL, headers={"Accept": "application/json"}
                    ) as response,
                ):
                    response.raise_for_status()
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > 256 * 1024:
                            raise ValueError("metadata too large")
                data = json.loads(content)
                version = data.get("version", "")
                if (
                    data.get("name") != "@openai/codex"
                    or not VERSION.fullmatch(version)
                    or VERSION.fullmatch(version)[4]
                ):
                    raise ValueError("invalid release")
                self.update = {
                    "status": "ok",
                    "latest_version": version,
                    "checked_at": checked,
                    "source": "npm · @openai/codex · latest",
                }
            except (
                httpx.HTTPError,
                TimeoutError,
                ValueError,
                TypeError,
                AttributeError,
            ):
                self.update = {
                    "status": "unavailable",
                    "latest_version": None,
                    "checked_at": checked,
                    "message": "暂时无法检查更新，现有连接不受影响，可稍后重试或查看官方安装说明。",
                }
            self.update_at = time.monotonic()
            return self.snapshot()
