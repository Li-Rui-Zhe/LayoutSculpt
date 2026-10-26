// pnpm commands use the same project Python environment as dev:all.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findPython } from "./python.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const args =
  mode === "launch"
    ? ["scripts/launcher_ui.py"]
    : mode === "test"
      ? ["-m", "pytest", "backend/tests", "-q", ...process.argv.slice(3)]
      : ["dev", "start", "all"].includes(mode)
        ? ["scripts/startup.py", mode, ...process.argv.slice(3)]
        : null;
try {
  if (!args)
    throw new Error("支持的启动方式：test / dev / start / all / launch");
  const result = spawnSync(findPython(root), args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PYTHONUTF8: "1" },
    windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(`启动未完成：${error.message}`);
  process.exit(1);
}
