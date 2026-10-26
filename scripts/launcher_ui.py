"""Double-click launcher: start/reuse automatically, only failures need action."""

import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import webbrowser

from startup import Launcher, ROOT


class StartupWindow:
    def __init__(self, window):
        import tkinter as tk
        from tkinter import ttk

        self.window = window
        self.events = queue.Queue()
        self.busy = False
        self.launcher = None
        self.close_job = None
        window.title("LayoutSculpt · 启动工作台")
        window.geometry("560x270")
        window.resizable(False, False)
        window.protocol("WM_DELETE_WINDOW", self.close)
        panel = ttk.Frame(window, padding=24)
        panel.pack(fill="both", expand=True)
        ttk.Label(panel, text="LayoutSculpt", font=("Microsoft YaHei UI", 18, "bold")).pack(anchor="w")
        self.message = tk.StringVar(value="正在检查服务…")
        ttk.Label(panel, textvariable=self.message, wraplength=505, justify="left").pack(anchor="w", pady=(16, 12))
        self.progress = ttk.Progressbar(panel, mode="indeterminate")
        self.progress.pack(fill="x", pady=(0, 16))
        self.actions = ttk.Frame(panel)
        self.retry = ttk.Button(self.actions, text="重试", command=self.start)
        self.retry.pack(side="left")
        ttk.Button(self.actions, text="查看日志", command=lambda: self.open_path(ROOT / "data" / "logs")).pack(side="left", padx=8)
        self.hint = ttk.Label(panel, text="会自动打开工作台，无需重复点击。", foreground="#66736b")
        self.hint.pack(anchor="w", pady=(8, 0))
        self.start_job = window.after(50, self.start)
        self.poll_job = window.after(100, self.poll)

    def start(self):
        if self.busy:
            return
        self.busy = True
        self.actions.pack_forget()
        self.hint.configure(text="会自动打开工作台，无需重复点击。")
        self.progress.start(12)
        self.launcher = Launcher(notify=lambda text: self.events.put(("progress", text)))

        def work():
            try:
                url = self.launcher.start()
                opened = webbrowser.open(url)
                self.events.put(("success", (url, opened)))
            except Exception as exc:
                self.events.put(("error", str(exc)))

        # Finish the startup/cleanup before closing; no abandoned half-starts.
        threading.Thread(target=work, daemon=False).start()

    def poll(self):
        try:
            while True:
                kind, value = self.events.get_nowait()
                if kind == "progress":
                    self.message.set(value)
                    continue
                self.busy = False
                self.progress.stop()
                if kind == "error":
                    self.message.set(value)
                    self.actions.pack(anchor="w", before=self.hint)
                    self.hint.configure(text="修复后点击重试；不会关闭其他项目，也不会修改设计内容。")
                else:
                    url, opened = value
                    self.message.set(f"工作台已就绪：{url}/")
                    self.hint.configure(text="关闭此窗口后，后台服务会继续运行。")
                    if opened:
                        self.close_job = self.window.after(1500, self.close)
                    else:
                        self.message.set(f"工作台已就绪，请在浏览器打开：{url}/")
        except queue.Empty:
            pass
        self.poll_job = self.window.after(100, self.poll)

    def open_path(self, path: Path):
        if not path.exists():
            self.message.set("尚未生成日志。请先按上方提示检查环境，再点击重试。")
            return
        try:
            if os.name == "nt":
                os.startfile(str(path))
            else:
                subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(path)])
        except OSError:
            self.message.set(f"请手动打开：{path}")

    def close(self):
        if self.busy:
            self.hint.configure(text="正在启动或清理本次进程，请稍候再关闭。")
        else:
            for job in (self.start_job, self.poll_job, self.close_job):
                if job:
                    self.window.after_cancel(job)
            self.window.destroy()


def main():
    import tkinter as tk
    window = tk.Tk()
    StartupWindow(window)
    window.mainloop()


if __name__ == "__main__":
    main()
