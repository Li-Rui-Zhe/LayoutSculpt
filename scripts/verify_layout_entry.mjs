import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const id = process.argv[2];
if (!/^[a-f0-9]{32}$/.test(id || "")) throw Error("请提供成功任务 ID。");
const output = "data/visual-review/layout-entry";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [],
  checks = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (jobId) => localStorage.setItem("habitat-job", jobId),
    id,
  );
  const sourceUrl = `http://127.0.0.1:5173/api/jobs/${id}/artifacts/layout.json`;
  const original = await (await page.request.get(sourceUrl)).text();
  for (const width of [1440, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:5173/", {
      waitUntil: "domcontentloaded",
    });
    const entry = page.getByRole("button", {
      name: "手动调整布局",
      exact: true,
    });
    await expect(entry).toBeVisible();
    await expect(entry).toHaveCount(1);
    expect(
      await entry
        .locator("span")
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).not.toBe("0px");
    const bounds = await entry.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(64);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width > 1000) {
      await page.getByRole("button", { name: "外观设置", exact: true }).click();
      await expect(entry).toBeVisible();
      await page
        .getByRole("button", { name: "收起设置面板", exact: true })
        .click();
    }
    if (width === 1440 || width === 390) {
      await expect(page.locator("#viewport canvas")).toHaveAttribute(
        "data-model-url",
        `/api/jobs/${id}/artifacts/model.glb`,
        { timeout: 30000 },
      );
      await page.screenshot({ path: `${output}/${width}.png` });
    }
    await entry.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("application", { name: "人工设计平面图" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(entry).toBeHidden();
    await page.getByRole("button", { name: "返回三维", exact: true }).click();
    await expect(entry).toBeVisible();
    await page.getByRole("button", { name: "原始户型", exact: true }).click();
    await entry.click();
    await expect(
      page.getByRole("application", { name: "人工设计平面图" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "返回三维", exact: true }).click();
    checks.push(
      `${width}px：顶部文字入口可见，无横向溢出，键盘与鼠标均可直接进入并返回`,
    );
  }
  expect(await (await page.request.get(sourceUrl)).text()).toBe(original);
  await page.getByRole("button", { name: "探索示例空间", exact: true }).click();
  await expect(page.locator("#viewport canvas")).toHaveAttribute(
    "data-model-url",
    "/models/apartment.glb",
    { timeout: 30000 },
  );
  await expect(
    page.getByRole("button", { name: "手动调整布局", exact: true }),
  ).toHaveCount(0);
  checks.push("示例模型不展示无效编辑入口，已有任务的布局数据保持不变");
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
