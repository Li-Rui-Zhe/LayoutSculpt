import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.REVIEW_URL || "http://127.0.0.1:8011";
const output = "data/visual-review/prelaunch";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
const checks = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1050 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await expect(page.locator("#viewport canvas")).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByRole("button", { name: "新建生成任务", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /使用示例户型/ }).click();
  await expect(page.locator(".upload-drop img")).toBeVisible();
  await page.getByLabel("任务名称").fill("浏览器验收 · 独立测试数据");
  await expect(
    page.getByRole("button", { name: "创建并开始生成" }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "创建并开始生成" }).click();
  await expect(
    page.getByRole("heading", { name: "先确认结构，再生成三维" }),
  ).toBeVisible({ timeout: 30000 });
  const confirm = page.getByRole("button", {
    name: "确认结构并继续",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await expect(page.getByAltText("用于核对的原始户型图")).toBeVisible();
  await page.screenshot({
    path: `${output}/structure-review.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `${output}/review-mobile.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1600, height: 1050 });
  checks.push("上传后进入人工结构核对，未勾选确认不能生成");

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "先确认结构，再生成三维" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "调整识别结构" }).click();
  await expect(
    page.getByRole("button", { name: "确认修改并继续生成" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "返回结构核对", exact: true }).click();
  await page.getByRole("checkbox", { name: /我已核对墙体/ }).check();
  await confirm.click();
  await expect(page.locator("#viewport canvas")).toHaveAttribute(
    "data-model-url",
    /\/api\/jobs\/.+\/model.glb/,
    { timeout: 30000 },
  );
  await page.getByRole("button", { name: "外观设置", exact: true }).click();
  await expect(
    page.getByText("原图结构已人工核对 · 模型截面校验通过", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "收起设置面板", exact: true }).click();
  await page.getByRole("button", { name: /夜晚/ }).click();
  await expect(page.locator("#viewport canvas")).toHaveAttribute(
    "data-lighting-preset",
    "night",
  );
  expect(
    Number(
      await page
        .locator("#viewport canvas")
        .getAttribute("data-design-light-count"),
    ),
  ).toBeGreaterThan(0);
  checks.push(
    "刷新保留待核对状态，确认后真实 GLB 与一致性证明交付，夜晚灯具点亮",
  );

  await page.getByRole("button", { name: "方案概览", exact: true }).click();
  await page.getByRole("button", { name: "改进方案", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "改进当前方案" }),
  ).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "交付成果", exact: true }).click();
  const proofLink = page
    .locator("a.deliverable-card")
    .filter({ hasText: "结构一致性" });
  await expect(proofLink).toBeVisible();
  const proof = await (
    await page.request.get(
      new URL(await proofLink.getAttribute("href"), base).href,
    )
  ).json();
  expect(
    proof.source_reviewed && proof.geometry_verified && proof.outline_verified,
  ).toBe(true);
  await page.getByRole("button", { name: /前往设计预览/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByAltText("当前任务的三维效果图")).toBeVisible();
  await page.keyboard.press("Escape");
  checks.push(
    "统一改进入口和键盘关闭弹窗，成果页下载一致性证明并正确导出效果图",
  );

  await page.screenshot({
    path: `${output}/workspace-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator("#viewport canvas")).toBeVisible({
    timeout: 30000,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "切换任务栏" }).click();
  await expect(page.locator("#task-drawer")).toBeVisible();
  const backdrop = page.getByRole("button", { name: "收起任务栏" });
  const backdropBox = await backdrop.boundingBox();
  await backdrop.click({
    position: { x: backdropBox.width - 12, y: backdropBox.height / 2 },
  });
  await page.screenshot({
    path: `${output}/workspace-mobile.png`,
    fullPage: true,
  });
  checks.push("390 像素移动端不横向溢出，任务栏可打开并收起");

  const blocked = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  blocked.on("pageerror", (error) => errors.push(error.message));
  await blocked.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage unavailable", "QuotaExceededError");
    };
    Storage.prototype.getItem = () => {
      throw new DOMException("Storage unavailable", "SecurityError");
    };
  });
  await blocked.goto(base);
  await expect(blocked.locator("#viewport canvas")).toBeVisible({
    timeout: 30000,
  });
  await expect(blocked.getByText(/浏览器存储不可用/)).toBeVisible();
  await blocked.getByRole("button", { name: /夜晚/ }).click();
  await expect(blocked.locator("#viewport canvas")).toHaveAttribute(
    "data-lighting-preset",
    "night",
  );
  await blocked
    .getByRole("button", { name: "新建生成任务", exact: true })
    .first()
    .click();
  await expect(
    blocked.getByRole("heading", { name: "把户型图，变成你的设计。" }),
  ).toBeVisible();
  await expect(blocked.getByLabel("生成模型", { exact: true })).toHaveValue(
    "test-default",
  );
  checks.push("浏览器存储受限时继续使用外观调整并明确提示");
  expect(errors).toEqual([]);
  const report = { checkedAt: new Date().toISOString(), base, checks, errors };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
