import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { launchReviewBrowser } from "./browser.mjs";

const base = process.env.REVIEW_URL;
if (!base)
  throw new Error(
    "请通过 node scripts/prelaunch.mjs --recognition-checkpoint 启动隔离验收",
  );
const output = "data/visual-review/recognition-checkpoint";
await mkdir(output, { recursive: true });
const browser = await launchReviewBrowser();
const errors = [],
  checks = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole("button", { name: "新建方案", exact: true }).click();
  await page.getByText("高级设置", { exact: true }).click();
  await page.getByRole("radio", { name: /快速识别/ }).check();
  const choice = page.getByRole("checkbox", {
    name: "先看平面图，确认后再生成 3D",
    exact: true,
  });
  await expect(choice).toBeVisible();
  await expect(choice).not.toBeChecked();
  await choice.scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + "/choice-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await choice.scrollIntoViewIfNeeded();
  await choice.check();
  await expect(page.locator(".generation-review-choice")).toContainText(
    "只在平面转 3D 前确认一次",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: output + "/choice-mobile.png" });
  checks.push("展开高级设置后显示平面图开关，手机可操作且无横向溢出");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /使用示例户型/ }).click();
  const submitted = page.waitForResponse(
    (r) => r.url().endsWith("/api/jobs") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "生成 3D 模型", exact: true }).click();
  const created = await submitted;
  expect(created.status()).toBe(201);
  const job = await created.json();
  const review = page.locator(".structure-review");
  await expect(
    review.getByRole("heading", { name: "先确认结构，再生成三维" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(review).toContainText("唯一一次确认");
  await expect(review).toContainText("6.0 厘米");
  await expect(
    review.getByRole("img", { name: "识别出的墙体、房间和门窗结构图" }),
  ).toBeVisible();
  await expect(
    review.getByRole("button", { name: "已核对，继续生成" }),
  ).toBeEnabled();
  const paused = await (
    await page.request.get(`${base}/api/jobs/${job.id}`)
  ).json();
  expect(paused.status).toBe("awaiting_review");
  expect(paused.progress).toBe(45);
  expect(paused.result.ai_review.method).toBe("automatic_resolution");
  await page.screenshot({
    path: output + "/checkpoint-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(review).toContainText("6.0 厘米");
  await page.setViewportSize({ width: 390, height: 844 });
  await review
    .getByRole("button", { name: "已核对，继续生成" })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: output + "/checkpoint-mobile.png",
    fullPage: true,
  });
  checks.push("AI 自动修正墙端后只在转三维前展示平面图，刷新保留同一次确认");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await review
    .getByRole("button", { name: "调整识别结构", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "返回结构核对", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "我已核对修改后的墙体和门窗" }),
  ).toHaveCount(0);
  const confirm = page.getByRole("button", {
    name: "确认修改并继续生成",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  checks.push("进入平面编辑器后可直接一次确认并生成，无需再勾选或返回审核页");
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${base}/api/jobs/${job.id}`)).json())
          .status,
      { timeout: 120000 },
    )
    .toBe("succeeded");
  const final = await (
    await page.request.get(`${base}/api/jobs/${job.id}`)
  ).json();
  expect(final.result.consistency.source_reviewed).toBe(true);
  expect(final.result.consistency.geometry_verified).toBe(true);
  const model = await page.request.get(
    `${base}/api/jobs/${job.id}/artifacts/model.glb`,
  );
  expect((await model.body()).subarray(0, 4).toString()).toBe("glTF");
  checks.push(
    "接受后继续家具规划与真实 GLB 建模，确认记录与实际几何校验均通过",
  );
  expect(errors).toEqual([]);
  await writeFile(
    output + "/report.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }));
} finally {
  await browser.close();
}
