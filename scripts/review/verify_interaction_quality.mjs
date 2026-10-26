import { launchReviewBrowser } from "./browser.mjs";
import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.REVIEW_URL || "http://127.0.0.1:8000";
const browser = await launchReviewBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  const canvas = page.locator("#viewport canvas");
  await expect(canvas).toBeVisible({ timeout: 60000 });
  await expect(canvas).toHaveAttribute("data-model-url", /.+/, {
    timeout: 60000,
  });
  const width = await canvas.evaluate((element) => element.clientWidth);
  await expect
    .poll(() => canvas.evaluate((element) => element.width))
    .toBe(width * 2);
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.53, {
    steps: 8,
  });
  const draggingWidth = await canvas.evaluate((element) => element.width);
  expect(draggingWidth).toBe(Math.floor(width * 1.25));
  await page.mouse.up();
  await expect
    .poll(() => canvas.evaluate((element) => element.width))
    .toBe(width * 2);
  await page
    .getByRole("button", { name: "导出当前效果图", exact: true })
    .click();
  await expect(page.getByAltText("当前任务的三维效果图")).toBeVisible();
  const imageWidth = await page
    .getByAltText("当前任务的三维效果图")
    .evaluate((image) => image.naturalWidth);
  expect(imageWidth).toBe(width * 2);
  expect(errors).toEqual([]);
  const output = "data/visual-review/interaction-quality";
  await mkdir(output, { recursive: true });
  const report = {
    base,
    deviceScaleFactor: 2,
    cssWidth: width,
    draggingWidth,
    restoredWidth: width * 2,
    exportWidth: imageWidth,
    errors,
  };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
