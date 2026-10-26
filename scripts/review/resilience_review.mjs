import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { launchReviewBrowser } from "./browser.mjs";

const base = process.env.REVIEW_URL;
if (!base) throw new Error("请通过 test:prelaunch 使用独立验收服务");
const browser = await launchReviewBrowser();
const errors = [],
  checks = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (error) => errors.push(error.message));
try {
  const jobs = await (await page.request.get(`${base}/api/jobs/page`)).json();
  const completed = jobs.items.find((item) => item.status === "succeeded");
  if (!completed) throw new Error("缺少预上线流程生成的测试任务");
  let current = { ...completed, status: "running", result: null };
  const listed = () => ({
    items: [current],
    cursor: "review-cursor",
    before: null,
  });
  await page.route("**/api/jobs/page*", (route) =>
    route.fulfill({ json: listed() }),
  );
  await page.route("**/api/jobs/changes*", (route) =>
    route.fulfill({ json: listed() }),
  );
  await page.route(`**/api/jobs/${completed.id}`, (route) =>
    route.fulfill({ json: current }),
  );
  await page.route(`**/api/jobs/${completed.id}/events`, (route) =>
    route.fulfill({ contentType: "text/event-stream", body: ": waiting\n\n" }),
  );
  await page.goto(`${base}/?project=${completed.id}&tab=assets`);
  await expect(
    page.getByRole("heading", { name: "成果将在这里汇集" }),
  ).toBeVisible();
  current = { ...completed, updated_at: new Date().toISOString() };
  await page.evaluate(() =>
    window.dispatchEvent(new Event("habitat:runtime-changed")),
  );
  await expect(
    page.getByRole("button", { name: /下载最新成果包|更新并导出成果包/ }),
  ).toBeEnabled({ timeout: 15000 });
  checks.push("交付页等待生成完成后自动核对并允许导出");
  await page.unrouteAll({ behavior: "wait" });

  let offline = true;
  await page.route("**/api/drafts/library:new", (route) =>
    offline
      ? route.fulfill({ status: 503, json: { detail: "模拟连接中断" } })
      : route.continue(),
  );
  await page.goto(`${base}/#library`);
  await expect(
    page.getByRole("button", { name: "重试同步", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".library-card").first()).toBeVisible();
  const count = await page.locator(".library-card").count();
  expect(count).toBeLessThanOrEqual(48);
  const more = page.getByRole("button", { name: /加载更多素材/ });
  if (await more.count()) {
    await more.click();
    expect(await page.locator(".library-card").count()).toBeGreaterThan(count);
  }
  await page.getByRole("button", { name: "☆ 收藏素材", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "★ 已收藏", exact: true }),
  ).toBeVisible();
  offline = false;
  await page.getByRole("button", { name: "重试同步", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重试同步", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(async () => {
      const value = await (
        await page.request.get(`${base}/api/drafts/library:new`)
      ).json();
      return value.document?.favorites?.length || 0;
    })
    .toBeGreaterThan(0);
  checks.push("断线时收藏可操作、恢复后同步，素材卡片分批展示");
  await page.unrouteAll({ behavior: "wait" });

  // DIY/素材预览和主场景分别拥有渲染器，两个入口都覆盖。
  for (const url of [
    `${base}/#library`,
    `${base}/?project=sample&tab=design`,
  ]) {
    await page.goto(url);
    const selector = url.includes("#library")
      ? ".diy-preview canvas"
      : "#viewport canvas";
    await expect(page.locator(selector)).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.locator(selector).evaluate((canvas) => {
      const extension = canvas
        .getContext("webgl2")
        .getExtension("WEBGL_lose_context");
      if (!extension) throw new Error("验收设备不支持模拟上下文丢失");
      extension.loseContext();
    });
    await expect(
      page.getByRole("button", { name: "恢复三维预览", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "恢复三维预览", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "恢复三维预览", exact: true }),
    ).toHaveCount(0, { timeout: 10000 });
    expect(
      await page
        .locator(selector)
        .evaluate((canvas) => canvas.getContext("webgl2").isContextLost()),
    ).toBe(false);
  }
  checks.push("主场景与素材预览均可恢复 WebGL 上下文，无需整页刷新");

  const original = await (await page.request.get(base)).text();
  await page.route(`${base}/`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: original.replace(
        /\/assets\/index-[^"\s]+\.js/,
        "/assets/index-new-review.js",
      ),
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("status", { name: "工作台更新" })).toBeVisible();
  await page.getByRole("button", { name: "稍后更新" }).click();
  await expect(page.getByRole("status", { name: "工作台更新" })).toHaveCount(0);
  checks.push("新版提示不强制刷新，可关闭并继续设计");
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await mkdir("data/visual-review/resilience", { recursive: true });
  await writeFile(
    "data/visual-review/resilience/report.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
}
