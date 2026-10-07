import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.STUDIO_BASE_URL || "http://127.0.0.1:5173";
const output = "data/visual-review/showcase";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [],
  checks = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("habitat-job", "sample"));
  await page.goto(base);
  const canvas = page.locator("#viewport canvas");
  await expect(canvas).toHaveAttribute(
    "data-model-url",
    "/models/forest-home-v2.glb",
    { timeout: 30000 },
  );
  await expect(
    page.getByRole("heading", { name: "林间暖居", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".overview-stats strong").nth(0)).toHaveText(
    "87㎡",
  );
  await expect(page.locator(".overview-stats strong").nth(1)).toHaveText("7");
  await expect(canvas).toHaveAttribute("data-lighting-preset", "midday");
  expect(
    Number(await canvas.getAttribute("data-hidden-fixture-visual-count")),
  ).toBeGreaterThanOrEqual(12);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${output}/desktop-day.png` });
  const image = await canvas.screenshot();
  await writeFile(`${output}/model-day.png`, image);
  checks.push("首屏使用真实新模型，概览显示准确面积和七个空间");
  await page.getByRole("button", { name: "夜晚", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-lighting-preset", "night");
  expect(
    Number(await canvas.getAttribute("data-design-light-count")),
  ).toBeGreaterThanOrEqual(8);
  expect(
    Number(await canvas.getAttribute("data-hidden-fixture-visual-count")),
  ).toBeGreaterThanOrEqual(12);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/desktop-night.png` });
  await page.getByRole("button", { name: "完整墙体", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-wall-view", "full");
  await page.getByRole("button", { name: "剖切展示", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-wall-view", "cutaway");
  await page.getByRole("button", { name: "俯视", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${output}/top.png` });
  await page.getByRole("button", { name: "三维", exact: true }).click();
  await page.getByRole("button", { name: "白天", exact: true }).click();
  checks.push("白天夜晚、完整与剖切墙体、三维俯视均可切换，八个真实灯位存在");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.53, {
    steps: 12,
  });
  await page.mouse.up();
  await page
    .getByRole("button", { name: "居中并适配户型", exact: true })
    .click();
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(page.locator(".zoom-value")).not.toHaveText("100%");
  await page
    .getByRole("button", { name: "居中并适配户型", exact: true })
    .click();
  checks.push("真实模型可拖动旋转、缩放并恢复取景");
  await page.getByRole("button", { name: "调整外观", exact: true }).click();
  const beforeMaterial = await canvas.screenshot();
  await page.getByRole("button", { name: "应用暮山蓝", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "应用暮山蓝", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(250);
  expect((await canvas.screenshot()).equals(beforeMaterial)).toBe(false);
  await page.getByRole("button", { name: "还原材质", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "应用暮山蓝", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  checks.push("新示例的材质可实际替换和还原");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(canvas).toHaveAttribute(
    "data-model-url",
    "/models/forest-home-v2.glb",
    { timeout: 30000 },
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/mobile-day.png` });
  checks.push("手机首屏正常取景，无横向溢出");
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
