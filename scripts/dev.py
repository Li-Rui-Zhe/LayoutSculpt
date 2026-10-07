"""一条命令启动前后端；Ctrl+C 同时关闭本次启动的进程树。"""

from pathlib import Path
import os
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    local_python = (
        ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    )
    python = str(local_python) if local_python.exists() else sys.executable
    node = shutil.which("node")
    if not node or not (ROOT / "node_modules" / "vite" / "bin" / "vite.js").exists():
        raise SystemExit("请先执行 pnpm install 和 Python 依赖安装。")
    env = {**os.environ, "PYTHONUTF8": "1"}
    processes = []
    try:
        commands = [
            [
                python,
                "-m",
                "uvicorn",
                "backend.app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
            [
                node,
                str(ROOT / "node_modules" / "vite" / "bin" / "vite.js"),
                "--config",
                "frontend/vite.config.js",
            ],
        ]
        for command in commands:
            processes.append(subprocess.Popen(command, cwd=ROOT, env=env))
        print(
            "工作台：http://127.0.0.1:5173/  API：http://127.0.0.1:8000/docs",
            flush=True,
        )
        while all(p.poll() is None for p in processes):
            time.sleep(0.5)
        stopped = next(p for p in processes if p.poll() is not None)
        print(f"本地服务进程已退出（退出码 {stopped.returncode}）：{stopped.args}", file=sys.stderr, flush=True)
        raise SystemExit(stopped.returncode or 1)
    except KeyboardInterrupt:
        pass
    finally:
        for process in processes:
            if process.poll() is not None:
                continue
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
            else:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    main()
