import { expect } from "@playwright/test";
import { launchReviewBrowser } from "./browser.mjs";
import { mkdir, writeFile } from "node:fs/promises";

const output = "data/visual-review/workbench-connection";
await mkdir(output, { recursive: true });
const browser = await launchReviewBrowser();
const errors = [],
  requests = [];
const heldReads = [];
let offline = false,
  healthChecks = 0,
  release;
let provider = "deepseek",
  configured = true,
  failedPath = "",
  hangReads = false;
const initial = new Promise((resolve) => {
  release = resolve;
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.clock.install();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    requests.push({ path: url.pathname, method: request.method() });
    if (request.method() !== "GET")
      throw new Error("Unexpected write: " + url.pathname);
    if (hangReads && url.pathname !== "/api/client-access") {
      await new Promise((resolve) => heldReads.push({ route, resolve }));
      return;
    }
    if (offline) return route.abort("connectionrefused");
    const fulfill = (json) => route.fulfill({ json });
    if (url.pathname === failedPath)
      return route.fulfill({
        status: 500,
        json: { detail: "模拟单个读取接口失败" },
      });
    if (url.pathname === "/api/health") {
      healthChecks++;
      await initial;
      return fulfill({
        status: "ok",
        ai: { provider, deepseek_configured: configured },
        codex: { connected: provider === "codex" },
      });
    }
    if (url.pathname === "/api/client-access")
      return fulfill({
        application: "layoutsculpt",
        protocol: 1,
        origin: url.origin,
        write_allowed: true,
      });
    if (url.pathname === "/api/models")
      return fulfill({
        provider: "deepseek",
        default_model: "deepseek::example",
        items: [
          {
            id: "deepseek::example",
            name: "Example",
            supports_image: true,
            available: true,
            efforts: [],
          },
        ],
      });
    return fulfill({ items: [], cursor: "0", before: null, more: false });
  });
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  const status = page.locator(".header-meta .connection");
  await expect(status).toHaveText("正在连接工作台");
  release();
  await expect(status).toHaveText("工作台在线 · DeepSeek 已配置");
  await page.getByRole("button", { name: "新建生成任务", exact: true }).click();
  const requirements = page.getByPlaceholder(
    "例如：保留原图墙体与门窗，客厅使用三人沙发和原木家具。",
  );
  await requirements.fill("连接恢复后保留这份设计要求");
  const beforeFailure = healthChecks;
  offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.fastForward(12001);
  await expect(status).toHaveText("工作台未连接");
  const notice = page.getByRole("alert", { name: "工作台连接检查" });
  await expect(notice).toContainText("使用 DeepSeek API");
  await expect(notice).toContainText("以保存任务和生成三维");
  await expect(requirements).toHaveValue("连接恢复后保留这份设计要求");
  await page.screenshot({ path: output + "/offline.png" });
  offline = false;
  await notice.getByRole("button", { name: "重新检测", exact: true }).click();
  await expect(status).toHaveText("工作台在线 · DeepSeek 已配置");
  await expect(notice).toHaveCount(0);
  await expect(requirements).toHaveValue("连接恢复后保留这份设计要求");
  expect(healthChecks).toBeGreaterThan(beforeFailure);
  for (const [path, message] of [
    ["/api/jobs/changes", "任务记录暂时无法同步"],
    ["/api/project-metadata", "项目信息暂时无法同步"],
  ]) {
    failedPath = path;
    await page.clock.fastForward(12001);
    await expect(status).toHaveText("工作台在线 · DeepSeek 已配置");
    await expect(notice).toContainText(message);
    await expect(notice).not.toContainText("启动工作台");
    await expect(requirements).toHaveValue("连接恢复后保留这份设计要求");
    failedPath = "";
    await notice.getByRole("button", { name: "重新检测", exact: true }).click();
    await expect(notice).toHaveCount(0);
  }
  offline = true;
  await page.clock.fastForward(12001);
  await expect(status).toHaveText("工作台未连接");
  offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(status).toHaveText("工作台在线 · DeepSeek 已配置");
  await expect(notice).toHaveCount(0);
  provider = "codex";
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("habitat:ai-changed", { detail: { provider: "codex" } }),
    ),
  );
  await expect(status).toHaveText("工作台在线 · Codex 已连接");
  provider = "deepseek";
  configured = false;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("habitat:ai-changed", {
        detail: { provider: "deepseek" },
      }),
    ),
  );
  await expect(status).toHaveText("工作台在线 · DeepSeek 待配置");
  configured = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(status).toHaveText("工作台在线 · DeepSeek 已配置");
  hangReads = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => heldReads.length).toBe(3);
  const pendingCount = requests.length;
  await page.clock.fastForward(12001);
  expect(requests.length).toBe(pendingCount);
  await page.clock.fastForward(4000);
  await expect(status).toHaveText("工作台未连接");
  hangReads = false;
  for (const pending of heldReads) {
    await pending.route.abort().catch(() => {});
    pending.resolve();
  }
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(status).toHaveText("工作台在线 · DeepSeek 已配置");
  await expect(notice).toHaveCount(0);
  expect(requests.filter((r) => /codex|runtime/.test(r.path))).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: output + "/recovered.png" });
  const report = {
    checks: [
      "加载、离线与 DeepSeek 在线状态区分",
      "中断后立即重试刷新健康状态，不受 30 秒缓存影响",
      "断连和恢复均保留当前表单",
      "任务接口和项目信息接口故障均不误报整个工作台离线",
      "网络恢复和页面聚焦即时更新",
      "来源切换和 DeepSeek 待配置状态即时更新",
      "慢请求不被下一轮轮询挤掉，超时能结束并恢复",
      "全程无 Codex 运行时请求、无写入、无页面异常",
    ],
    healthChecks,
    errors,
  };
  await writeFile(output + "/report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  release();
  await browser.close();
}
