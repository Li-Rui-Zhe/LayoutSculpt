import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import path from "node:path";

// Match FastAPI: only project .env plus existing process environment.
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
export const frontendPort = Number(process.env.STUDIO_FRONTEND_PORT ?? 5173);
if (
  !Number.isInteger(frontendPort) ||
  frontendPort < 1 ||
  frontendPort > 65535 ||
  frontendPort === 8000
) {
  throw new Error(
    "STUDIO_FRONTEND_PORT 必须是 1 到 65535 的整数，且不能与后端 8000 相同",
  );
}

export function assertFrontendPort(actual, expected = frontendPort) {
  if (actual !== expected) {
    throw new Error(
      `前端启动端口 ${actual} 与配置 ${expected} 不一致。请在项目 .env 设置 STUDIO_FRONTEND_PORT 并重启前后端，不要单独使用 --port 改端口。`,
    );
  }
}

export const frontendPortGuard = {
  name: "layoutsculpt-port-guard",
  configResolved(config) {
    if (config.command === "serve") {
      assertFrontendPort(
        config.isPreview ? config.preview.port : config.server.port,
      );
    }
  },
  configureServer(server) {
    const root = path
      .resolve(fileURLToPath(new URL("..", import.meta.url)))
      .replaceAll("\\", "/");
    const key = process.platform === "win32" ? root.toLowerCase() : root;
    const projectId = createHash("sha256").update(key).digest("hex");
    server.middlewares.use("/__layoutsculpt_frontend", (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(
        JSON.stringify({
          application: "layoutsculpt-frontend",
          protocol: 1,
          project_id: projectId,
        }),
      );
    });
  },
};
