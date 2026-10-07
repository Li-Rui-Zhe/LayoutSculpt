import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const id = process.argv[2];
if (!/^[a-f0-9]{32}$/.test(id || ""))
  throw new Error("请提供已有成功任务 ID。");
const output = "data/visual-review/light-workspace";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [],
  metrics = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (jobId) => localStorage.setItem("habitat-job", jobId),
    id,
  );
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [800, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("http://127.0.0.1:5173/");
    const canvas = page.locator("#viewport canvas");
    await expect(canvas).toHaveAttribute(
      "data-model-url",
      `/api/jobs/${id}/artifacts/model.glb`,
      { timeout: 30000 },
    );
    if (width > 1000) {
      await expect(page.locator(".inspector")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "你的空间方案" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "查看原始户型图" }),
      ).toBeVisible();
    } else await expect(page.locator(".inspector")).toBeHidden();
    await expect(page.locator("#task-drawer")).toBeHidden();
    const cutView = page.getByRole("button", { name: "剖切展示", exact: true });
    const fullView = page.getByRole("button", {
      name: "完整墙体",
      exact: true,
    });
    await expect(cutView).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveAttribute("data-wall-view", "cutaway");
    await fullView.focus();
    await page.keyboard.press("Space");
    await expect(fullView).toHaveAttribute("aria-pressed", "true");
    await expect(cutView).toHaveAttribute("aria-pressed", "false");
    await expect(canvas).toHaveAttribute("data-wall-view", "full");
    if (width === 1920) {
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${output}/${width}-full-walls.png` });
      await page.reload();
      await expect(canvas).toHaveAttribute(
        "data-model-url",
        `/api/jobs/${id}/artifacts/model.glb`,
        { timeout: 30000 },
      );
      await expect(fullView).toHaveAttribute("aria-pressed", "true");
      await expect(canvas).toHaveAttribute("data-wall-view", "full");
    }
    await cutView.click();
    await expect(cutView).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveAttribute("data-wall-view", "cutaway");
    await page.getByRole("button", { name: "白天", exact: true }).click();
    await expect(canvas).toHaveAttribute("data-lighting-preset", "midday");
    await page
      .getByRole("button", { name: "居中并适配户型", exact: true })
      .click();
    await expect(page.locator(".zoom-value")).toHaveText("100%");
    const box = await canvas.boundingBox();
    expect(box.width / width).toBeGreaterThan(width > 1000 ? 0.69 : 0.8);
    expect(box.height / height).toBeGreaterThan(0.75);
    for (const label of [
      "三维",
      "俯视",
      "剖切展示",
      "完整墙体",
      "放大",
      "导出当前效果图",
    ]) {
      const control = await page
        .getByRole("button", { name: label, exact: true })
        .boundingBox();
      expect(
        control.y + control.height <= box.y + 1 ||
          control.y >= box.y + box.height - 1,
      ).toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${output}/${width}-day.png` });
    await page.getByRole("button", { name: "夜晚", exact: true }).click();
    await expect(canvas).toHaveAttribute("data-lighting-preset", "night");
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${output}/${width}-night.png` });
    await page.getByRole("button", { name: "外观设置", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "应用雾岛绿", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "应用雾岛绿", exact: true }).click();
    const dayCard = page.getByRole("button", {
      name: "切换到白天",
      exact: true,
    });
    const nightCard = page.getByRole("button", {
      name: "切换到夜晚",
      exact: true,
    });
    await dayCard.click();
    await expect(dayCard).toHaveAttribute("aria-pressed", "true");
    await expect(nightCard).toHaveAttribute("aria-pressed", "false");
    await expect(
      page
        .locator(".quick-lighting")
        .getByRole("button", {
          name: "白天",
          exact: true,
          includeHidden: true,
        }),
    ).toHaveAttribute("aria-pressed", "true");
    await nightCard.focus();
    await page.keyboard.press("Enter");
    await expect(nightCard).toHaveAttribute("aria-pressed", "true");
    await expect(dayCard).toHaveAttribute("aria-pressed", "false");
    await expect(
      page
        .locator(".quick-lighting")
        .getByRole("button", {
          name: "夜晚",
          exact: true,
          includeHidden: true,
        }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: `${output}/${width}-settings.png` });
    await page
      .getByRole("button", { name: "收起设置面板", exact: true })
      .click();
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("data-lighting-preset", "night");
    await page.getByRole("button", { name: "俯视", exact: true }).click();
    await page
      .getByRole("button", { name: "居中并适配户型", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "俯视", exact: true }),
    ).toHaveClass("active");
    await page.getByRole("button", { name: "三维", exact: true }).click();
    await page.getByRole("button", { name: "切换任务栏" }).click();
    await expect(page.locator("#task-drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#task-drawer")).toBeHidden();
    await page.getByRole("button", { name: "任务详情", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "任务状态", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".inspector")).toBeHidden();
    await page.getByRole("button", { name: "方案概览", exact: true }).click();
    await page
      .getByRole("button", { name: "查看原始户型图", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "原始户型图", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "设计预览", exact: true }).click();
    await expect(canvas).toBeVisible();
    metrics.push({
      width,
      height,
      canvas: box,
      canvasWidthRatio: box.width / width,
      canvasHeightRatio: box.height / height,
      controlsOutsideCanvas: true,
      wallViewSwitching: true,
    });
  }
  expect(errors).toEqual([]);
  const report = { id, metrics, errors };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
