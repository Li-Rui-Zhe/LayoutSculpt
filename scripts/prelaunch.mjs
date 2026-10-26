import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { findPython } from "./python.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(path.join(root, "dist", "index.html")))
  throw new Error("请先执行 pnpm build。");
// Use a free test port without stopping or reusing any existing service.
const socket = createServer();
await new Promise((resolve, reject) => {
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", resolve);
});
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const testData = path.join(root, "data", "prelaunch-tests", randomUUID());
const child = spawn(
  findPython(root),
  [
    "-m",
    "uvicorn",
    "backend.tests.prelaunch_app:app",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      STUDIO_TEST_PORT: String(port),
      STUDIO_TEST_DATA: testData,
    },
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
  if (!process.argv.includes("--progressive")) {
    await import("./review/prelaunch_review.mjs");
    await import("./review/resilience_review.mjs");
  }
  await import("./review/progressive_review.mjs");
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
