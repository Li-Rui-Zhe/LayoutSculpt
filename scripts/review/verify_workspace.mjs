import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const jobId = process.argv[2];
if (!/^[a-f0-9]{32}$/.test(jobId || ""))
  throw new Error("Pass a generated job ID");
await mkdir("data/visual-review/workspace", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push(`${message.text()} ${message.location().url}`);
  });
  await page.addInitScript(
    (id) => localStorage.setItem("habitat-job", id),
    jobId,
  );
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  const canvas = page.locator("#viewport canvas");
  await expect(canvas).toHaveAttribute(
    "data-model-url",
    `/api/jobs/${jobId}/artifacts/model.glb`,
    { timeout: 30000 },
  );
  await page.getByRole("button", { name: "外观设置", exact: true }).click();
  await page.getByRole("button", { name: /夜晚/ }).click();
  await expect(canvas).toHaveAttribute("data-lighting-preset", "night");
  expect(
    Number(await canvas.getAttribute("data-design-light-count")),
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: "收起设置面板", exact: true }).click();
  await page.getByRole("button", { name: "完整墙体", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-wall-view", "full");
  await page.getByRole("button", { name: "剖切展示", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-wall-view", "cutaway");
  await page.getByRole("button", { name: "俯视", exact: true }).click();
  await page.getByRole("button", { name: /白天/ }).click();
  await expect(canvas).toHaveAttribute("data-lighting-preset", "midday");
  await page.getByRole("button", { name: "三维", exact: true }).click();
  await page
    .getByRole("button", { name: "导出当前效果图", exact: true })
    .click();
  await expect(page.getByAltText("当前任务的三维效果图")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "data/visual-review/workspace/page.png" });
  const model = await page.request.get(
    `http://127.0.0.1:5173/api/jobs/${jobId}/artifacts/model.glb`,
  );
  expect(model.status()).toBe(200);
  expect((await model.body()).subarray(0, 4).toString()).toBe("glTF");
  console.log(
    JSON.stringify({
      jobId,
      errors,
      tested: ["load", "night", "cutaway", "top", "day", "export", "download"],
    }),
  );
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
