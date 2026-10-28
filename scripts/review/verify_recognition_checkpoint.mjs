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
  await page.getByRole("button", { name: "新建生成任务", exact: true }).click();
  await page.getByRole("radio", { name: /快速识别/ }).check();
  const choice = page.getByRole("checkbox", {
    name: "先看平面图，确认后再生成 3D",
    exact: true,
  });
  await expect(choice).toBeVisible();
  await expect(choice).not.toBeChecked();
  expect(await choice.evaluate((element) => !!element.closest("details"))).toBe(
    false,
  );
  await choice.scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + "/choice-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await choice.scrollIntoViewIfNeeded();
  await choice.check();
  await expect(page.locator(".generation-review-choice")).toContainText(
    "由你决定何时生成 3D",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: output + "/choice-mobile.png" });
  checks.push("平面图开关在高级设置外始终可见，手机可操作且无横向溢出");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /使用示例户型/ }).click();
  const submitted = page.waitForResponse(
    (r) => r.url().endsWith("/api/jobs") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "创建并开始生成", exact: true })
    .click();
  const created = await submitted;
  expect(created.status()).toBe(201);
  let job = await created.json();
  const review = page.locator(".structure-review");
  await expect(
    review.getByRole("heading", { name: "识别遇到卡点，请先看看平面图" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(review).toContainText("第 1 次");
  await expect(review).toContainText("第 2 次");
  await expect(review).toContainText("6.0 厘米");
  await expect(
    review.getByRole("img", { name: "识别出的墙体、房间和门窗结构图" }),
  ).toBeVisible();
  await expect(
    review.getByRole("button", { name: "接受平面图，继续生成 3D" }),
  ).toBeEnabled();
  const paused = await (
    await page.request.get(`${base}/api/jobs/${job.id}`)
  ).json();
  expect(paused.status).toBe("awaiting_review");
  expect(paused.result.recognition_review.attempts).toHaveLength(2);
  await page.screenshot({
    path: output + "/checkpoint-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(review).toContainText("AI 已尝试 2 次");
  await page.setViewportSize({ width: 390, height: 844 });
  await review
    .getByRole("button", { name: "接受平面图，继续生成 3D" })
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
  checks.push(
    "两次识别失败后展示平面图、两次原因和微调说明，等待用户选择，刷新仍保留",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await review.getByRole("button", { name: "调整平面图", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "返回结构核对", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回结构核对", exact: true }).click();
  const retried = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/jobs/${job.id}/retry`) &&
      r.request().method() === "POST",
  );
  await review.getByRole("button", { name: "重新识别", exact: true }).click();
  const response = await retried;
  expect(response.status()).toBe(201);
  const previousId = job.id;
  job = await response.json();
  expect(job.id).not.toBe(previousId);
  await expect(
    review.getByRole("button", { name: "接受平面图，继续生成 3D" }),
  ).toBeEnabled({ timeout: 30000 });
  checks.push("可进入平面编辑或主动重新识别，原结果保留为独立版本");
  await review.getByRole("button", { name: "接受平面图，继续生成 3D" }).click();
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
