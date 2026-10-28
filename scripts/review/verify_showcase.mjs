import { launchReviewBrowser } from "./browser.mjs";
import { expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
const showcase = JSON.parse(await readFile(new URL("../../frontend/src/showcase.json", import.meta.url), "utf8"));
const base = process.env.STUDIO_BASE_URL || "http://127.0.0.1:8000";
const output = "data/visual-review/showcase";
await mkdir(output, { recursive: true });
const browser = await launchReviewBrowser();
const errors = [], writes = [], checks = [];
let modelRequests = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes(showcase.model_url)) modelRequests++;
  });
  // 独立上下文，隔离草稿写入和真实任务，截图只包含公开样板间。
  await page.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.includes("/drafts/"))
      return route.fulfill({ json: { document: null, revision: 0, updated_at: null } });
    if (path === "/api/jobs" && request.method() === "GET")
      return route.fulfill({ json: { items: [] } });
    if (["GET", "HEAD"].includes(request.method())) return route.continue();
    writes.push(path);
    return route.fulfill({ status: 409, json: { detail: "验收隔离，不修改实际任务" } });
  });
  await page.goto(`${base}/?project=sample&tab=design`);
  const canvas = page.locator("#viewport canvas");
  await expect(canvas).toBeVisible({ timeout: 120000 });
  await expect(canvas).toHaveAttribute("data-model-url", new RegExp(showcase.model_url.replaceAll(".", "\\.")));
  await expect(page.locator(".canvas-loading")).toHaveCount(0, { timeout: 120000 });
  await expect(page.getByRole("heading", { name: showcase.title.split(" · ")[0], exact: true })).toBeVisible();
  await expect(page.locator(".overview-stats strong").nth(0)).toHaveText(`${showcase.area}㎡`);
  await expect(page.locator(".overview-stats strong").nth(1)).toHaveText(String(showcase.room_count));
  const renderer = await canvas.getAttribute("data-renderer-id");
  const requests = modelRequests;
  for (const [id, name] of [["midday", "晴天"], ["sunset", "日落"], ["night", "夜晚"]]) {
    await page.locator(".environment-trigger").click();
    await expect(page.getByRole("button", { name: "切换到柔和阴天", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: `切换到${name}`, exact: true }).click();
    await expect(canvas).toHaveAttribute("data-lighting-preset", id);
    await page.waitForTimeout(1000);
    await canvas.screenshot({ path: `${output}/${id}.png` });
    expect(await canvas.getAttribute("data-renderer-id")).toBe(renderer);
    expect(modelRequests).toBe(requests);
  }
  checks.push("准确显示新名称、面积和七个分区；三种环境复用模型与画布");
  await page.locator(".environment-trigger").click();
  await page.getByRole("button", { name: "切换到晴天", exact: true }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${output}/desktop.png` });
  for (const room of ["terrace", "living", "bedroom"]) {
    await page.getByRole("combobox", { name: "定位房间" }).selectOption(room);
    await page.waitForTimeout(800);
    await canvas.screenshot({ path: `${output}/detail-${room}.png` });
  }
  await page.getByRole("combobox", { name: "定位房间" }).selectOption("");
  checks.push("露台、客厅、主卧可以定位近看，复查家具支撑与摆放");
  await page.getByRole("button", { name: "完整墙体", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-wall-view", "full");
  await canvas.screenshot({ path: `${output}/full-walls.png` });
  await page.getByRole("button", { name: "剖切展示", exact: true }).click();
  await page.getByRole("button", { name: "俯视", exact: true }).click();
  await canvas.screenshot({ path: `${output}/top.png` });
  await page.getByRole("button", { name: "三维", exact: true }).click();
  checks.push("完整墙体、剖切及俯视均可切换，保留真实三维模型");
  await page.setViewportSize({ width: 390, height: 844 });
  const close = page.getByRole("button", { name: "关闭设置面板", exact: true });
  if (await close.isVisible()) await close.click();
  await expect(canvas).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${output}/mobile.png` });
  await page.locator(".environment-trigger").click();
  const box = await page.locator(".environment-panel").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${output}/mobile-environment.png` });
  checks.push("手机画布和三列环境菜单正常，无横向溢出");
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  console.log(JSON.stringify({ checks, errors, writes }, null, 2));
} finally {
  await browser.close();
}
