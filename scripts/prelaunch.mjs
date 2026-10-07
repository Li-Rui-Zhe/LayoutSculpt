import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(path.join(root, "dist", "index.html")))
  throw new Error("请先执行 pnpm build。");
const base = "http://127.0.0.1:8011";
try {
  await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
  throw new Error("验收端口 8011 已被占用，请先关闭使用该端口的服务。");
} catch (error) {
  if (error.message.includes("8011 已被占用")) throw error;
}
const local = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const child = spawn(
  existsSync(local) ? local : "python",
  [
    "-m",
    "uvicorn",
    "backend.tests.prelaunch_app:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8011",
  ],
  {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PYTHONUTF8: "1" },
  },
);
let serverLog = "";
child.stderr.on("data", (data) => {
  serverLog = (serverLog + data).slice(-8000);
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`验收服务启动失败：${serverLog}`);
    try {
      const response = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(500),
      });
      ready = response.ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error(`验收服务启动超时：${serverLog}`);
  process.env.REVIEW_URL = base;
  await import("./prelaunch_review.mjs");
} finally {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {}
  } else {
    child.kill("SIGTERM");
  }
}
