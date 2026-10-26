"""Explicit browser login, scoped to the project's selected CLI process."""

import asyncio
from urllib.parse import urlsplit

from .codex import CodexClient, CodexError


class CodexLogin:
    def __init__(self, local):
        self.local = local
        self.lock = asyncio.Lock()
        self.state = {"status": "idle"}
        self.task = None
        self.login_id = None
        self.owner = None

    def snapshot(self):
        return dict(self.state)

    async def start(self):
        async with self.lock:
            if self.task and not self.task.done():
                return self.snapshot()
            local = self.local
            if not isinstance(local, CodexClient):
                raise CodexError("当前连接不支持页面登录。")
            async with local.lock:
                if local.maintenance or local.active_generations or local.threads or local.pending:
                    raise CodexError("Codex 正在处理任务，请任务结束后再登录。")
                local.maintenance = True
                self.owner = local.maintenance_owner = asyncio.current_task()
            self.login_id = None
            try:
                await local.ensure_started()
                local.login_completed = None
                result = await local.request("account/login/start", {"type": "chatgpt"}, 30)
                self.login_id = result.get("loginId")
                address = result.get("authUrl", "")
                parsed = urlsplit(address)
                if (result.get("type") != "chatgpt" or not self.login_id or parsed.scheme != "https"
                    or parsed.hostname not in {"auth.openai.com", "auth0.openai.com", "chatgpt.com"}
                    or parsed.username or parsed.password or parsed.port not in {None, 443}):
                    raise CodexError("此 CLI 未返回可用的官方登录入口，请更新 CLI 后重试。")
                self.state = {"status": "waiting", "url": address,
                              "message": "请在官方页面完成登录，完成后这里会自动继续。"}
                self.task = asyncio.create_task(self.watch())
                return self.snapshot()
            except BaseException:
                await self.cancel_remote()
                self.release()
                self.state = {"status": "failed", "message": "无法打开登录，请检查网络或更新 Codex 后重试。"}
                raise CodexError(self.state["message"]) from None

    async def cancel_remote(self):
        if self.login_id and self.local.alive:
            try:
                await self.local.request("account/login/cancel", {"loginId": self.login_id}, 5)
            except (CodexError, OSError, TimeoutError):
                pass

    def release(self):
        if self.owner is not None and getattr(self.local, "maintenance_owner", None) is self.owner:
            self.local.maintenance = False
            self.local.maintenance_owner = None
        self.login_id = None
        self.owner = None

    async def watch(self):
        try:
            async with asyncio.timeout(600):
                while self.local.alive:
                    result = self.local.login_completed
                    if result and result.get("loginId") == self.login_id:
                        success = result.get("success") is True
                        self.state = {"status": "succeeded" if success else "failed",
                                      "message": "登录完成，正在检查可用模型。" if success else "登录未完成，请重试。"}
                        return
                    await asyncio.sleep(0.5)
                self.state = {"status": "failed", "message": "登录连接已断开，请重试。"}
        except TimeoutError:
            self.state = {"status": "failed", "message": "登录已超时，请重新打开登录。"}
            await self.cancel_remote()
        except asyncio.CancelledError:
            await self.cancel_remote()
            raise
        finally:
            self.release()

    async def cancel(self):
        async with self.lock:
            if self.task and not self.task.done():
                self.task.cancel()
                await asyncio.gather(self.task, return_exceptions=True)
            # A task cancelled before its first step does not execute finally.
            await self.cancel_remote()
            self.release()
            self.state = {"status": "cancelled", "message": "已取消本次登录。"}
            return self.snapshot()

    async def close(self):
        await self.cancel()
