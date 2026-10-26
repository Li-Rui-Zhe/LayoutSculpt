"""Install official Codex binaries for this project, with atomic activation."""

import asyncio
import json
import platform
import shutil
import time
import tempfile
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

from .ai_credentials import atomic_private_write
from .codex import CodexClient, CodexError
from .codex_runtime import VERSION, cli_version, now
from .runtime_downloads import Downloads, InstallError, extract_archive
from .toolchain_paths import read_active, runtime_root, selected_tool

TERMINAL = {"succeeded", "failed", "cancelled"}


def host_target():
    system = {"Windows": "win32", "Darwin": "darwin", "Linux": "linux"}.get(
        platform.system()
    )
    arch = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(
        platform.machine().lower()
    )
    if not system or not arch:
        raise InstallError("此系统或处理器暂不支持一键安装，请使用官方安装方式。")
    return system, arch


class CodexInstaller:
    def __init__(self, settings, runtime):
        self.settings, self.runtime = settings, runtime
        self.root = runtime_root(settings.data_dir)
        self.downloads = Downloads(self.root)
        self.job = None
        self.task = None
        self.lock = asyncio.Lock()
        self.progress_at = 0
        self.candidate_dir = None
        self.job_path = self.root / "codex-operation.json"
        try:
            job = json.loads(self.job_path.read_text(encoding="utf-8"))
            if isinstance(job, dict) and job.get("status") in {
                "running",
                "queued",
                *TERMINAL,
            }:
                self.job = job
                if job["status"] not in TERMINAL:
                    self.job.update(
                        status="failed",
                        stage="interrupted",
                        message="服务重启中断了 CLI 准备，可重试；原安装和已校验下载仍保留。",
                    )
        except (OSError, ValueError, TypeError):
            pass

    def persist(self):
        if self.job:
            atomic_private_write(
                self.job_path, json.dumps(self.job, ensure_ascii=False).encode()
            )

    def stage(self, stage, message):
        self.job.update(
            stage=stage,
            message=message,
            updated_at=now(),
            downloaded_bytes=None,
            total_bytes=None,
        )
        self.job.setdefault("events", []).append({"at": now(), "message": message})
        self.job["events"] = self.job["events"][-12:]
        self.persist()

    async def progress(self, count, total):
        self.job.update(downloaded_bytes=count, total_bytes=total)
        if time.monotonic() - self.progress_at > 0.5 or count == total:
            self.progress_at = time.monotonic()
            self.persist()

    def snapshot(self):
        active = read_active(self.settings.data_dir).get("codex", {})
        return {
            "job": self.job,
            "install_dir": str(self.root / "packages/codex"),
            "managed": bool(selected_tool(self.settings.data_dir, "codex")),
            "environment": self.runtime.local.environment_mode if isinstance(self.runtime.local, CodexClient) else "shared",
            "can_rollback": bool(
                selected_tool(
                    self.settings.data_dir, "codex", entry=active.get("previous")
                )
            ),
            "can_use_system": bool(
                active
                and (
                    shutil.which(self.settings.codex_command)
                    or Path(self.settings.codex_command).is_file()
                )
            ),
            "diagnostics": self.runtime.snapshot(),
        }

    async def start(self, action="install"):
        async with self.lock:
            if self.task and not self.task.done():
                if (self.job or {}).get("action") == action:
                    return self.snapshot()
                raise InstallError("已有 CLI 操作正在进行，请等待完成。")
            if action not in {"install", "isolated", "rollback", "system"}:
                raise InstallError("不支持此 CLI 操作。")
            local = self.runtime.local
            if not isinstance(local, CodexClient):
                raise InstallError("当前本机连接不支持自动更新。")
            if local.maintenance or (action in {"rollback", "system", "isolated"} and (local.active_generations or local.threads or local.pending)):
                raise InstallError(
                    "本机 Codex 正在处理任务，请等待任务结束后更新 CLI。"
                )
            host_target()
            self.job = {
                "id": uuid4().hex,
                "action": action,
                "status": "queued",
                "stage": "queued",
                "message": "正在准备 Codex CLI…",
                "created_at": now(),
                "updated_at": now(),
                "events": [],
            }
            self.persist()
            self.task = asyncio.create_task(self.run(action))
            return self.snapshot()

    async def run(self, action):
        self.job["status"] = "running"
        self.candidate_dir = None
        try:
            async with asyncio.timeout(900):
                if action in {"install", "isolated"}:
                    await self.install()
                else:
                    await self.restore(system=action == "system")
                self.job["status"] = "succeeded"
                message = "Codex CLI 已准备完成，已自动重连并完成协议复检。"
                if self.job.get("needs_login"):
                    message = "Codex CLI 安装与协议验证已完成；请登录后重新检测模型。"
                self.stage("complete", message)
        except asyncio.CancelledError:
            self.job["status"] = "cancelled"
            self.stage("cancelled", "CLI 操作已取消，当前设计和原安装仍保留。")
            raise
        except Exception as exc:  # noqa: BLE001 - keep network/subprocess credentials out of job records
            self.job["status"] = "failed"
            message = (
                str(exc)
                if isinstance(exc, InstallError)
                else "CLI 准备失败，请检查网络、磁盘空间及目录权限后重试；原安装仍保留。"
            )
            self.stage("failed", message)
        finally:
            if self.candidate_dir and self.job["status"] != "succeeded":
                target = self.candidate_dir.resolve()
                selected = selected_tool(self.settings.data_dir, "codex")
                if target.is_relative_to(
                    (self.root / "packages/codex").resolve()
                ) and not (selected and Path(selected).is_relative_to(target)):
                    await asyncio.to_thread(shutil.rmtree, target, True)
            self.candidate_dir = None

    async def cancel(self):
        if self.task and not self.task.done():
            if self.job.get("stage") in {"activate", "reconnect", "restore"}:
                raise InstallError("正在切换并验证 CLI，请等待本步骤完成。")
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        return self.snapshot()

    async def close(self):
        if self.task and not self.task.done():
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)

    def write_active(self, data):
        atomic_private_write(self.root / "active.json", json.dumps(data).encode())

    async def verify(self, path, version):
        self.stage("verify", "正在验证 Codex 的版本和连接协议…")
        if await cli_version(str(path)) != version:
            raise InstallError("Codex 版本验证失败，未切换原环境。")
        candidate = CodexClient(replace(self.settings, codex_command=str(path)))
        candidate.command_override = str(path)
        # A candidate version must never initialize against live credentials/config.
        temporary = tempfile.TemporaryDirectory(prefix="verify-", dir=self.root)
        candidate.environment_override = "isolated"
        candidate.home_override = temporary.name
        try:
            await asyncio.wait_for(candidate.ensure_started(), 40)
        except (CodexError, OSError, TimeoutError):
            raise InstallError(
                "此 Codex 未通过启动与协议验证，未切换原环境。"
            ) from None
        finally:
            await candidate.stop()
            temporary.cleanup()

    async def activate(self, path, version, *, system=False, config_mode=None):
        local = self.runtime.local
        await self.verify(path, version)
        old_active, old_command = read_active(self.settings.data_dir), local.command
        active = dict(old_active)
        if system:
            active.pop("codex", None)
        else:
            resolved = Path(path).resolve()
            if not resolved.is_relative_to(self.root):
                raise InstallError("CLI 路径超出本项目的安装目录。")
            record = {
                "path": resolved.relative_to(self.root).as_posix(),
                "version": version,
                "prepared_at": now(),
                "config_mode": config_mode or ("isolated" if self.job.get("action") == "isolated" else local.environment_mode),
            }
            if selected_tool(self.settings.data_dir, "codex"):
                record["previous"] = {
                    k: v for k, v in old_active["codex"].items() if k != "previous"
                }
            active["codex"] = record
        self.stage("waiting_idle", "更新已准备好，等待当前任务结束后启用；当前任务继续使用原版本。")
        while True:
            async with local.lock:
                if not (local.maintenance or local.active_generations or local.threads or local.pending):
                    local.maintenance = True
                    local.maintenance_owner = asyncio.current_task()
                    break
            await asyncio.sleep(0.5)
        try:
            self.stage("activate", "正在切换本项目使用的 CLI…")
            async with local.lock:
                await local.stop()
                self.write_active(active)
                local.command_override = str(path)
            self.stage("reconnect", "正在重新连接 Codex 并读取模型…")
            diagnostic = (await self.runtime.inspect())["diagnostics"]
            if (
                diagnostic["status"] != "ready"
                and diagnostic.get("code") != "authentication"
            ):
                raise InstallError("新 CLI 未通过连接复检，已恢复原来的连接。")
            if diagnostic.get("code") == "authentication":
                self.job["needs_login"] = True
        except BaseException:
            async with local.lock:
                await local.stop()
                self.write_active(old_active)
                local.command_override = old_command
            await self.runtime.inspect()
            raise
        finally:
            local.maintenance = False
            local.maintenance_owner = None

    async def install(self):
        system, arch = host_target()
        self.stage("resolve", "正在查询 Codex 官方稳定版…")
        data = await self.downloads.metadata(
            "https://registry.npmjs.org/@openai%2fcodex/latest"
        )
        version = data.get("version", "")
        if (
            data.get("name") != "@openai/codex"
            or not VERSION.fullmatch(version)
            or VERSION.fullmatch(version)[4]
        ):
            raise InstallError("Codex 稳定版信息无效。")
        alias = data.get("optionalDependencies", {}).get(
            f"@openai/codex-{system}-{arch}"
        )
        if alias == f"npm:@openai/codex@{version}-{system}-{arch}":
            package, native_version = "codex", f"{version}-{system}-{arch}"
        elif alias == version:
            package, native_version = f"codex-{system}-{arch}", version
        else:
            raise InstallError("官方稳定版尚未提供适用于本系统的一键安装包。")
        native = await self.downloads.metadata(
            f"https://registry.npmjs.org/@openai%2f{package}/{native_version}"
        )
        if (
            native.get("name") != f"@openai/{package}"
            or native.get("version") != native_version
        ):
            raise InstallError("当前系统的 Codex 软件包信息无效。")
        dist = native["dist"]
        required = max(
            600 * 1024 * 1024, int(dist.get("unpackedSize", 0)) + 300 * 1024 * 1024
        )
        self.root.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(self.root).free < required:
            raise InstallError("CLI 安装目录空间不足，请至少预留 1 GB 空间后重试。")
        self.job["target_version"] = version
        self.stage("download", f"正在下载 Codex {version}，完成后校验软件包…")
        archive = await self.downloads.archive(
            dist["tarball"], dist["integrity"], self.progress
        )
        folder = self.root / "packages/codex" / f"{version}-{uuid4().hex[:10]}"
        folder.mkdir(parents=True, exist_ok=False)
        self.candidate_dir = folder
        self.stage("extract", "完整性校验通过，正在解压 Codex…")
        unpacking = asyncio.create_task(
            asyncio.to_thread(extract_archive, archive, folder)
        )
        try:
            await asyncio.shield(unpacking)
        except asyncio.CancelledError:
            # Extraction owns files in this directory; finish it before cleanup.
            await unpacking
            raise
        candidates = [
            p
            for p in folder.rglob("codex.exe" if system == "win32" else "codex")
            if p.is_file()
        ]
        if len(candidates) != 1:
            raise InstallError("Codex 软件包中没有找到唯一的可执行文件。")
        await self.activate(candidates[0], version)

    async def restore(self, *, system=False):
        if system:
            path = (
                shutil.which(self.settings.codex_command) or self.settings.codex_command
            )
            if not Path(path).is_file():
                raise InstallError("未找到原来的本机 Codex CLI。")
            version = await cli_version(path)
        else:
            record = (
                read_active(self.settings.data_dir).get("codex", {}).get("previous")
            )
            path = selected_tool(self.settings.data_dir, "codex", entry=record)
            if not path or not VERSION.fullmatch(record.get("version", "")):
                raise InstallError("没有可恢复的项目 CLI 版本。")
            version = record["version"]
        await self.activate(Path(path), version, system=system, config_mode=None if system else record.get("config_mode", "shared"))
