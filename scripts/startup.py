"""Shared startup checks for the desktop launcher and terminal commands."""

from contextlib import contextmanager
from datetime import datetime
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
BASE = "http://127.0.0.1:8000"
_inherited_env = set(os.environ)
_dotenv_keys = set()


class StartupError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def read_json(url):
    try:
        with build_opener(ProxyHandler({}), NoRedirect()).open(url, timeout=2) as response:
            return json.loads(response.read(65536))
    except (OSError, ValueError):
        return None


def port_available(port):
    with socket.socket() as sock:
        if os.name == "nt":
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def load_settings():
    try:
        from dotenv import dotenv_values, load_dotenv
        # A GUI may stay open while .env is edited. Preserve inherited overrides,
        # but refresh values supplied by the project's file on every retry.
        global _dotenv_keys
        values = dotenv_values(ROOT / ".env")
        for key in (_dotenv_keys | values.keys()) - _inherited_env:
            os.environ.pop(key, None)
        load_dotenv(ROOT / ".env", override=False)
        _dotenv_keys = set(values)
        from backend.app.config import Settings
        return Settings()
    except ImportError as exc:
        raise StartupError("缺少 Python 依赖。请在项目环境执行 python -m pip install -r backend/requirements.txt，再点击重试。") from exc
    except ValueError as exc:
        raise StartupError(f"项目配置无效：{exc}。请打开配置文件修改后重试。") from exc


def inspect_service(settings, frontend=False):
    from backend.app.runtime_identity import instance_id, project_id
    port = settings.frontend_port if frontend else 8000
    base = f"http://127.0.0.1:{port}"
    info = read_json(base + ("/__layoutsculpt_frontend" if frontend else "/api/client-access"))
    app = "layoutsculpt-frontend" if frontend else "layoutsculpt"
    if isinstance(info, dict) and info.get("application") == app and info.get("protocol") == 1:
        if info.get("project_id") != project_id() or (not frontend and info.get("instance_id") != instance_id(settings)):
            return "other-project"
        if frontend:
            return "ready"
        health = read_json(BASE + "/api/health")
        return "ready" if isinstance(health, dict) and health.get("status") == "ok" else "starting"
    return "free" if port_available(port) else "occupied"


def conflict_message(state, port):
    if state == "other-project":
        return f"端口 {port} 上运行的是另一份项目或数据目录，不能直接复用。请关闭那份服务后重试。"
    if state == "starting":
        return f"本项目正在启动（端口 {port}），请稍后点击重新检查。"
    instruction = (
        "如需更换开发端口，请在 .env 设置 STUDIO_FRONTEND_PORT，再重启前后端。"
        if port != 8000 else "请先关闭占用该端口的程序；若是旧版本工作台，请先保存编辑内容再关闭旧服务。"
    )
    return f"端口 {port} 已被占用或不可用，暂时无法确认是当前项目。{instruction} 不会自动结束其他程序。"


@contextmanager
def startup_lock():
    folder = ROOT / ".codex"
    folder.mkdir(exist_ok=True)
    with (folder / "startup.lock").open("a+b") as handle:
        handle.seek(0, 2)
        if not handle.tell():
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise StartupError("另一个启动窗口正在处理，请稍后重新检查。") from exc
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


class Launcher:
    def __init__(self, mode="start", notify=lambda message: None):
        self.mode = mode
        self.notify = notify
        self.owned = []
        self.logs = []
        self.url = BASE
        self.reused = False

    def inspect(self):
        settings = load_settings()
        state = inspect_service(settings)
        if state == "ready" and not (ROOT / "dist" / "index.html").is_file():
            return {"state": "needs-build", "message": "后端已运行，但尚未构建页面。请执行 pnpm build 后重新检查。", "url": BASE}
        self.url = BASE
        return {"state": state, "message": "项目已运行，可以直接打开。" if state == "ready" else
                "项目尚未启动，点击启动即可。" if state == "free" else conflict_message(state, 8000), "url": BASE}

    def spawn(self, command, label):
        folder = ROOT / "data" / "logs"
        folder.mkdir(parents=True, exist_ok=True)
        log = folder / f"launch-{datetime.now():%Y%m%d-%H%M%S}-{os.getpid()}-{label}.log"
        self.logs.append(log)
        with log.open("ab") as output:
            process = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=output,
                stderr=subprocess.STDOUT, env={**os.environ, "PYTHONUTF8": "1"},
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                start_new_session=os.name != "nt")
        self.owned.append(process)
        return process

    def wait_ready(self, settings, process, frontend=False, timeout=45):
        deadline = time.monotonic() + timeout
        label = "前端" if frontend else "后端"
        while time.monotonic() < deadline:
            if process.poll() is not None:
                reason = ""
                tail = self.logs[-1].read_text(encoding="utf-8", errors="replace")[-16000:]
                if "ModuleNotFoundError" in tail:
                    reason = "缺少依赖，请在项目环境安装 backend/requirements.txt。"
                elif "已有服务运行" in tail:
                    reason = "同一数据目录已有服务运行，请先关闭旧服务。"
                elif "address already in use" in tail.lower() or "10048" in tail:
                    reason = "端口刚刚被其他程序占用，请重新检查。"
                raise StartupError(f"{label}启动失败（退出码 {process.returncode}）。{reason} 点击查看日志获取详情。")
            state = inspect_service(settings, frontend)
            if state == "ready":
                return
            if state == "other-project":
                raise StartupError(conflict_message(state, settings.frontend_port if frontend else 8000))
            time.sleep(0.4)
        raise StartupError(f"{label}在 {timeout} 秒内未就绪。本次新启动的进程将关闭，请查看日志后重试。")

    def start(self):
        try:
            with startup_lock():
                self.notify("正在检查环境和服务身份…")
                settings = load_settings()
                backend_state = inspect_service(settings)
                if backend_state not in {"ready", "free"}:
                    raise StartupError(conflict_message(backend_state, 8000))
                frontend_state = inspect_service(settings, True) if self.mode == "all" else None
                if frontend_state not in {None, "ready", "free"}:
                    raise StartupError(conflict_message(frontend_state, settings.frontend_port))
                if self.mode == "start" and not (ROOT / "dist" / "index.html").is_file():
                    raise StartupError("尚未构建前端页面，请在项目目录执行 pnpm install 和 pnpm build，再点击重试。")
                node = shutil.which("node")
                vite = ROOT / "node_modules" / "vite" / "bin" / "vite.js"
                if self.mode == "all" and (not node or not vite.is_file()):
                    raise StartupError("缺少前端运行环境，请安装 Node.js 并执行 pnpm install 后重试。")
                self.reused = backend_state == "ready"
                if not self.reused:
                    self.notify("正在检查数据备份，首次升级可能需要稍候…")
                    from backend.app.instance_lock import instance_lock
                    from backend.app.data_maintenance import prepare_data
                    with instance_lock(settings.data_dir):
                        prepare_data(settings.data_dir)
                    self.notify("正在启动后端，等待服务就绪…")
                    python = Path(sys.executable)
                    if os.name == "nt" and python.name.lower() == "pythonw.exe":
                        python = python.with_name("python.exe")
                    process = self.spawn([str(python), "-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "8000"], "backend")
                    self.wait_ready(settings, process)
                if self.mode == "all":
                    if frontend_state == "free":
                        self.notify("后端已就绪，正在启动开发页面…")
                        process = self.spawn([node, str(vite), "--config", "frontend/vite.config.js"], "frontend")
                        self.wait_ready(settings, process, frontend=True)
                    # Confirm the Vite proxy reaches this backend, not an unrelated API.
                    from backend.app.runtime_identity import instance_id
                    access = read_json(f"http://127.0.0.1:{settings.frontend_port}/api/client-access?origin=http://127.0.0.1:{settings.frontend_port}")
                    if not isinstance(access, dict) or access.get("instance_id") != instance_id(settings) or access.get("write_allowed") is not True:
                        raise StartupError("开发页面连接的后端或端口配置不一致。请先保存内容，再重启前后端。")
                    self.url = f"http://127.0.0.1:{settings.frontend_port}"
                self.notify("项目已运行，可以直接打开。" if self.reused else "启动成功，工作台已就绪。")
                return self.url
        except BaseException:
            self.stop_owned()
            raise

    def stop_owned(self):
        # Only processes created by this invocation; never stop reused services.
        for process in reversed(self.owned):
            if process.poll() is not None:
                continue
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
            else:
                import signal
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        self.owned.clear()


def main():
    import argparse
    import webbrowser
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["start", "dev", "all"], nargs="?", default="start")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    launcher = Launcher(args.mode, lambda message: print(message, flush=True))
    try:
        if args.check:
            print(json.dumps(launcher.inspect(), ensure_ascii=False))
            return
        url = launcher.start()
        print(f"工作台：{url}/", flush=True)
        if launcher.logs:
            print(f"运行日志：{launcher.logs[-1]}", flush=True)
        if not args.no_browser and args.mode != "dev":
            webbrowser.open(url)
        if launcher.owned:
            print("按 Ctrl+C 关闭本次启动的服务。已在运行的服务不会被关闭。", flush=True)
            while all(p.poll() is None for p in launcher.owned):
                time.sleep(0.5)
            raise StartupError("本次启动的服务已退出，请查看日志后重新启动。")
    except KeyboardInterrupt:
        pass
    except (StartupError, OSError, ValueError) as exc:
        print(f"启动未完成：{exc}", file=sys.stderr, flush=True)
        raise SystemExit(1)
    finally:
        launcher.stop_owned()


if __name__ == "__main__":
    main()
