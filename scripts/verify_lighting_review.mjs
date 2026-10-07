import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const id = process.argv[2];
if (!/^[a-f0-9]{32}$/.test(id || "")) throw Error("请提供已有成功任务 ID。");
const output = "data/visual-review/lighting-refined";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [],
  checks = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (jobId) => localStorage.setItem("habitat-job", jobId),
    id,
  );
  const sourceResponse = await page.request.get(
    `http://127.0.0.1:5173/api/jobs/${id}/artifacts/layout.json`,
  );
  const source = await sourceResponse.json();
  await page.goto("http://127.0.0.1:5173/");
  const canvas = page.locator("#viewport canvas");
  await expect(canvas).toHaveAttribute(
    "data-model-url",
    `/api/jobs/${id}/artifacts/model.glb`,
    { timeout: 30000 },
  );
  await expect(canvas).toHaveAttribute(
    "data-design-light-count",
    String(source.lights.length),
  );
  expect(
    Number(await canvas.getAttribute("data-hidden-fixture-visual-count")),
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: "剖切展示", exact: true }).click();
  await page.getByRole("button", { name: "白天", exact: true }).click();
  await page
    .getByRole("button", { name: "居中并适配户型", exact: true })
    .click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${output}/day.png` });
  await page.getByRole("button", { name: "夜晚", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-lighting-preset", "night");
  await expect(canvas).toHaveAttribute(
    "data-design-light-count",
    String(source.lights.length),
  );
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${output}/night.png` });
  checks.push(
    "已有任务直接隐藏占位灯泡和吊线，白天与夜晚的独立光源数量保持不变",
  );
  await page.getByRole("button", { name: "完整墙体", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-wall-view", "full");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/night-full.png` });
  await page.getByRole("button", { name: "剖切展示", exact: true }).click();
  await page.getByRole("button", { name: "俯视", exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/night-top.png` });
  checks.push("完整墙体、剖切和俯视切换都保留夜晚照明");
  await page.getByRole("button", { name: "手动调整布局", exact: true }).click();
  await page.getByRole("button", { name: "灯具", exact: true }).click();
  await expect(
    page.getByRole("application", { name: "人工设计平面图" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^选择灯具 / })).toHaveCount(
    source.lights.length,
  );
  const originalBrightness = source.lights[0].lumens;
  const brightness = page.getByRole("spinbutton", {
    name: "灯具亮度",
    exact: true,
  });
  await expect(brightness).toHaveValue(String(originalBrightness));
  await brightness.fill("300");
  await brightness.press("Enter");
  const saved = () =>
    page.evaluate(
      (jobId) =>
        JSON.parse(localStorage.getItem(`habitat-edit:${jobId}`))?.document,
      id,
    );
  await expect
    .poll(async () => (await saved()).layout.lights[0].lumens)
    .toBe(300);
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect
    .poll(async () => (await saved()).layout.lights[0].lumens)
    .toBe(originalBrightness);
  checks.push("平面编辑仍显示全部灯位，亮度可调整与撤销，未提交任何任务修改");
  const afterResponse = await page.request.get(
    `http://127.0.0.1:5173/api/jobs/${id}/artifacts/layout.json`,
  );
  expect(await afterResponse.json()).toEqual(source);
  await page.goto("http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "探索示例空间", exact: true }).click();
  await expect(canvas).toHaveAttribute(
    "data-model-url",
    "/models/apartment.glb",
    { timeout: 30000 },
  );
  await expect(canvas).toHaveAttribute("data-design-light-count", "3");
  await expect(canvas).toHaveAttribute("data-hidden-fixture-visual-count", "0");
  await page.getByRole("button", { name: "夜晚", exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/sample-night.png` });
  checks.push("示例模型的床头灯与落地灯继续显示并保留夜晚灯效");
  expect(errors).toEqual([]);
  const report = { id, checks, errors };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
