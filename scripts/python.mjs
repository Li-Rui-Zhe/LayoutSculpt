import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function findPython(
  root,
  { platform = process.platform, exists = existsSync, probe = spawnSync } = {},
) {
  const local = path.join(
    root,
    ".venv",
    platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (exists(local)) return local;
  for (const candidate of platform === "win32"
    ? ["python", "python3"]
    : ["python3", "python"]) {
    const result = probe(
      candidate,
      ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"],
      {
        stdio: "ignore",
        timeout: 5000,
        windowsHide: true,
      },
    );
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error(
    "未找到 Python 3.11+，请先安装 Python 并创建项目 .venv，再安装依赖。",
  );
}
