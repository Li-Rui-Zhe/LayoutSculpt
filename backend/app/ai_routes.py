"""Local-only AI connection settings; secrets are write-only and never returned."""

import asyncio
import shutil
from pathlib import Path
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from .ai_providers import DEEPSEEK_BASE, DEEPSEEK_PREFIX
from .codex import CodexClient, CodexError
from .codex_installer import CodexInstaller
from .codex_runtime import CodexRuntime
from .runtime_downloads import InstallError


class ConnectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["codex", "deepseek"]
    api_key: SecretStr | None = None

    @field_validator("api_key")
    @classmethod
    def valid_key(cls, value):
        if value is None:
            return None
        key = value.get_secret_value().strip()
        if not key:
            return None
        if (
            not 8 <= len(key) <= 4096
            or not key.isascii()
            or any(c.isspace() or ord(c) < 32 for c in key)
        ):
            raise ValueError("密钥格式无效，请粘贴完整密钥")
        return SecretStr(key)


class SaveConnection(ConnectionRequest):
    revision: int = Field(ge=0)
    model: str | None = Field(default=None, max_length=160)
    remove_key: bool = False


class InstallAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["install", "rollback", "system"] = "install"


def install_ai_routes(app, settings, client):
    store = client.connections
    lock = asyncio.Lock()
    runtime = CodexRuntime(settings, client.local)
    app.state.codex_runtime = runtime
    installer = CodexInstaller(settings, runtime)
    app.state.codex_installer = installer

    def public():
        try:
            has_key = bool(store.secret())
            warning = store.error
        except ValueError:
            has_key, warning = False, "本机密钥无法读取，请重新填写并保存。"
        return {
            "revision": store.data["revision"],
            "default_provider": store.data["default_provider"],
            "warning": warning,
            "codex": {
                "available": bool(
                    shutil.which(runtime.command) or Path(runtime.command).is_file()
                ),
                "connected": client.local.alive,
                "default_model": store.data.get("codex_model"),
                "runtime": runtime.snapshot(),
            },
            "deepseek": {
                "configured": has_key,
                "base_url": DEEPSEEK_BASE,
                "default_model": store.data.get("deepseek_model"),
                "key_storage": "本机加密存储",
            },
        }

    async def checked(body):
        if body.provider == "codex" and body.api_key:
            raise HTTPException(
                422, "本机 Codex 不需要额外密钥，请在 DeepSeek 连接中填写。"
            )
        try:
            async with asyncio.timeout(50):
                if body.provider == "codex":
                    if isinstance(client.local, CodexClient):
                        result = await runtime.inspect()
                        if result["diagnostics"]["status"] != "ready":
                            raise CodexError(result["diagnostics"]["message"])
                    return await client.list_models(refresh=True, provider="codex")
                key = body.api_key.get_secret_value() if body.api_key else None
                return await client.remote.list_models(refresh=True, key=key)
        except TimeoutError:
            raise HTTPException(504, "连接测试超时，请检查服务或网络后重试。") from None
        except CodexError as exc:
            raise HTTPException(503, str(exc)) from None
        except Exception:  # noqa: BLE001 - never expose upstream exceptions or credential-bearing responses
            raise HTTPException(
                503, "无法读取模型，请检查连接、登录状态或密钥后重试。"
            ) from None

    @app.get("/api/ai/settings")
    async def get_settings():
        return public()

    @app.post("/api/ai/codex/check")
    async def check_codex():
        return await runtime.inspect()

    @app.post("/api/ai/codex/reconnect")
    async def reconnect_codex():
        return await runtime.inspect(reconnect=True)

    @app.post("/api/ai/codex/updates")
    async def codex_updates():
        return await runtime.check_update()

    @app.get("/api/ai/codex/installation")
    async def get_installation():
        return installer.snapshot()

    @app.post("/api/ai/codex/install", status_code=202)
    async def install_codex(body: InstallAction):
        try:
            return await installer.start(body.action)
        except InstallError as exc:
            raise HTTPException(409, str(exc)) from None

    @app.post("/api/ai/codex/install/cancel")
    async def cancel_installation():
        try:
            return await installer.cancel()
        except InstallError as exc:
            raise HTTPException(409, str(exc)) from None

    @app.post("/api/ai/test")
    async def test_connection(body: ConnectionRequest):
        catalog = await checked(body)
        return {
            "provider": body.provider,
            "catalog": catalog,
            "message": f"连接成功，已读取 {len(catalog['items'])} 个模型。",
        }

    @app.post("/api/ai/settings")
    async def save_settings(body: SaveConnection):
        async with lock:
            if body.revision != store.data["revision"]:
                raise HTTPException(
                    409, "AI 设置已在其他窗口更新，请刷新设置后重新保存。"
                )
            if body.remove_key:
                if body.api_key or body.provider != "codex":
                    raise HTTPException(422, "移除连接时请切换到 Codex。")
                store.save(provider="codex", remove=True)
            else:
                catalog = await checked(body)
                model = body.model or catalog["default_model"]
                if not any(
                    item["id"] == model and item.get("available") is not False
                    for item in catalog["items"]
                ):
                    raise HTTPException(
                        422, "所选模型已不可用，请重新测试连接并选择模型。"
                    )
                secret = body.api_key.get_secret_value() if body.api_key else None
                try:
                    store.save(
                        provider=body.provider,
                        model=model.removeprefix(DEEPSEEK_PREFIX),
                        secret=secret,
                    )
                except (ValueError, OSError):
                    raise HTTPException(
                        503, "无法安全保存本机连接，请检查本地数据目录权限后重试。"
                    ) from None
            client.remote.catalog = None
            return public()
