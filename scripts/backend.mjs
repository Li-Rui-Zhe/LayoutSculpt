// pnpm commands use the same project Python environment as dev:all.
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const mode = process.argv[2];
const args =
  mode === "test"
    ? ["-m", "pytest", "backend/tests", "-q", ...process.argv.slice(3)]
    : ["dev", "start"].includes(mode)
      ? [
          "-m",
          "uvicorn",
          "backend.app.main:app",
          "--host",
          "127.0.0.1",
          "--port",
          "8000",
        ]
      : null;
if (!args) throw new Error("Use backend.mjs test|dev|start");
if (mode === "start" && !existsSync(path.join(root, "dist", "index.html"))) {
  throw new Error("请先执行 pnpm build，再执行 pnpm start。");
}
const result = spawnSync(existsSync(local) ? local : "python", args, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PYTHONUTF8: "1" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
