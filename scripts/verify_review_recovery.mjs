import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const originalId = process.argv[2];
const existingId = process.argv[3];
const base = process.env.STUDIO_BASE_URL || "http://127.0.0.1:5173";
if (!/^[a-f0-9]{32}$/.test(originalId || ""))
  throw Error("请提供复核失败任务 ID");
const output = "data/visual-review/review-recovery";
await mkdir(output, { recursive: true });
const report = { originalId, recoveredId: null, checks: [], errors: [] };
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.addInitScript((id) => {
    if (!localStorage.getItem("habitat-job"))
      localStorage.setItem("habitat-job", id);
  }, originalId);
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  const recover = page.getByRole("button", {
    name: "继续核对已识别结构",
    exact: true,
  });
  await expect(recover).toBeVisible();
  await page.screenshot({ path: `${output}/failed-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "任务详情", exact: true }).click();
  await expect(recover).toBeInViewport();
  await page.screenshot({ path: `${output}/failed-mobile.png` });
  let job;
  if (existingId) {
    if (!/^[a-f0-9]{32}$/.test(existingId)) throw Error("恢复任务 ID 无效");
    job = await (
      await page.request.get(`${base}/api/jobs/${existingId}`)
    ).json();
    await page.evaluate(
      (id) => localStorage.setItem("habitat-job", id),
      existingId,
    );
    await page.reload({ waitUntil: "domcontentloaded" });
  } else {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/jobs/${originalId}/retry`) &&
        r.request().method() === "POST",
    );
    await recover.click();
    const created = await response;
    expect(created.status()).toBe(201);
    job = await created.json();
  }
  report.recoveredId = job.id;
  expect(job.id).not.toBe(originalId);
  const review = page.locator(".structure-review");
  await expect(review).toBeVisible();
  await expect(review.locator(".review-status-warning")).toContainText(
    "AI 复核未完成",
  );
  await expect(
    review.getByRole("button", { name: "确认结构并继续", exact: true }),
  ).toBeDisabled();
  await expect(review.getByRole("checkbox")).not.toBeChecked();
  await expect(
    review.getByRole("img", { name: "识别出的墙体、房间和门窗结构图" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${output}/recovered-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${output}/recovered-desktop.png` });
  const original = await (
    await page.request.get(`${base}/api/jobs/${originalId}`)
  ).json();
  const recovered = await (
    await page.request.get(`${base}/api/jobs/${job.id}`)
  ).json();
  expect(original.status).toBe("failed");
  expect(recovered.status).toBe("awaiting_review");
  expect(recovered.result.ai_review.status).toBe("timed_out");
  const model = await page.request.get(
    `${base}/api/jobs/${job.id}/artifacts/model.glb`,
  );
  expect(model.status()).toBe(409);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".structure-review")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认结构并继续", exact: true }),
  ).toBeDisabled();
  report.checks.push(
    "桌面和手机可恢复已识别结构",
    "保留原失败任务，新任务直接进入人工核对",
    "AI 复核未完成明确显示，未确认禁止三维生成",
    "刷新保持核对阶段，无横向溢出",
  );
  expect(report.errors).toEqual([]);
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
