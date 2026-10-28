import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { launchReviewBrowser } from "./browser.mjs";

const base = process.env.REVIEW_URL;
if (!base) throw new Error("请通过 test:prelaunch 使用独立验收服务");
const output = "data/visual-review/progressive";
await mkdir(output, { recursive: true });
const browser = await launchReviewBrowser();
const errors = [],
  checks = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page
    .getByRole("button", { name: "新建生成任务", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("家具方案")).not.toBeVisible();
  await expect(
    page.locator('.model-advanced input[type="checkbox"]').last(),
  ).not.toBeChecked();
  await page.getByRole("button", { name: /使用示例户型/ }).click();
  await page.getByLabel("任务名称").fill("渐进生成验收");
  const submitted = page.waitForResponse(
    (r) => r.url() === `${base}/api/jobs` && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "创建并开始生成" }).click();
  const created = await (await submitted).json();
  expect(created.options.review_mode).toBe("preview");
  await expect(page.locator("#viewport canvas")).toHaveAttribute(
    "data-model-url",
    /\/preview\/model.glb/,
    { timeout: 120000 },
  );
  await expect(page.locator(".initial-preview-status")).toBeVisible();
  await expect(page.locator(".initial-preview-status")).toContainText(
    "尚未人工核对",
  );
  await page.screenshot({ path: `${output}/initial.png` });
  await expect(page.locator("#viewport canvas")).toHaveAttribute(
    "data-model-url",
    /\/artifacts\/model.glb/,
    { timeout: 120000 },
  );
  const completed = await (
    await page.request.get(`${base}/api/jobs/${created.id}`)
  ).json();
  expect(completed.status).toBe("succeeded");
  expect(completed.result.consistency.source_reviewed).toBe(false);
  await page.getByRole("button", { name: "关闭待核对提示" }).click();
  await expect(
    page.getByRole("button", { name: "关闭待核对提示" }),
  ).toHaveCount(0);
  checks.push(
    "默认生成显示真实三维初稿，再切换完整家具模型；不会伪造人工核对，提示可关闭",
  );

  // 仅替换响应，不触碰真实任务；验证同 ID 恢复时页面能重新订阅进度。
  let current = {
    ...completed,
    status: "failed",
    updated_at: new Date(Date.now() + 60000).toISOString(),
    error: "AI 服务登录失效，请检查接入。",
    result: { failure: { code: "authentication" } },
  };
  let continued = 0;
  await page.route(`**/api/jobs/${created.id}`, (route) =>
    route.fulfill({ json: current }),
  );
  await page.route("**/api/jobs/page*", (route) =>
    route.fulfill({ json: { items: [current], cursor: "test", before: null } }),
  );
  await page.route("**/api/jobs/changes*", (route) =>
    route.fulfill({ json: { items: [current], cursor: "test" } }),
  );
  await page.route(`**/api/jobs/${created.id}/events`, (route) =>
    route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" }),
  );
  await page.route(`**/api/jobs/${created.id}/continue`, async (route) => {
    expect(route.request().postDataJSON().revision).toBe(current.updated_at);
    continued++;
    current = {
      ...current,
      status: "running",
      stage: "继续布置家具",
      error: null,
      result: null,
      updated_at: new Date(Date.now() + 65000).toISOString(),
    };
    await route.fulfill({ json: current });
  });
  await page.goto(`${base}/?project=${created.id}&tab=activity`);
  await expect(
    page.getByRole("button", { name: "检查 AI 接入", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续生成", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消本次生成", exact: true }),
  ).toBeVisible();
  expect(continued).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("project")).toBe(created.id);
  checks.push(
    "失败后无需选模型，点击继续仍为同一任务，进度区恢复；登录错误提供接入入口",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
