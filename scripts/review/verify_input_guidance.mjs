// 隔离 API 写入，检查新建示例、拒绝回退及设计偏好恢复。
import { expect } from "@playwright/test";
import { launchReviewBrowser } from "./browser.mjs";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.STUDIO_BASE_URL || "http://127.0.0.1:5176";
const output = "data/visual-review/input-guidance";
await mkdir(output, { recursive: true });
const id = "bbbb0000000000000000000000000001";
const job = {
  id,
  name: "换图保留偏好验收",
  status: "failed",
  stage: "请更换户型图",
  progress: 12,
  created_at: "2026-10-28T12:00:00Z",
  updated_at: "2026-10-28T12:00:00Z",
  options: {
    style: "custom",
    style_description: "温暖的复古风",
    notes: "保留书房，需要儿童活动区",
    collaboration: false,
    review_mode: "preview",
    furniture_mode: "library",
    model: "test-model",
    effort: "medium",
  },
  source_url: "/sample-floorplan.png",
  error: "这张图片的主要墙线过于模糊，无法可靠识别，请更换清晰原图。",
  result: {
    input_check: {
      status: "rejected",
      reason: "severe_blur",
      evidence: "右侧房间墙线无法分辨",
    },
    failure: { code: "input_image_rejected" },
  },
};
const browser = await launchReviewBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [],
  writes = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      p = new URL(req.url()).pathname;
    const json = (value) => route.fulfill({ json: value });
    if (p === "/api/jobs/page")
      return json({ items: [job], cursor: "fixture", before: null });
    if (p === "/api/jobs/changes")
      return json({ items: [], cursor: "fixture", more: false });
    if (p === `/api/jobs/${id}`) return json(job);
    if (p === `/api/jobs/${id}/timeline`) return json({ items: [] });
    if (p.endsWith("/events"))
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": fixture\n\n",
      });
    if (p === "/api/models")
      return json({
        default_model: "test-model",
        items: [
          {
            id: "test-model",
            name: "测试模型",
            supports_image: true,
            efforts: ["medium"],
            default_effort: "medium",
          },
        ],
      });
    if (p === "/api/ai/settings") return json({ default_provider: "codex" });
    if (p.startsWith("/api/drafts/"))
      return json({ document: null, revision: 0 });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method())) {
      writes.push(p);
      return route.fulfill({
        status: 500,
        json: { detail: "验收禁止写入真实服务" },
      });
    }
    return route.continue();
  });
  await page.goto(`${base}/?project=${id}&tab=activity#workspace`);
  await expect(
    page.getByRole("heading", { name: "换一张更合适的户型图" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "继续生成", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "更换图片", exact: true }).click();
  const examples = page.getByRole("region", { name: "户型图上传正反示例" });
  await expect(examples).toBeVisible();
  await expect(examples.locator("figure")).toHaveCount(4);
  await expect(page.locator("#task-name")).toHaveValue(job.name);
  await expect(
    page.locator("textarea").filter({ visible: true }).first(),
  ).toHaveValue(job.options.style_description);
  await expect(page.getByLabel("设计要求", { exact: false })).toHaveValue(
    job.options.notes,
  );
  await expect(
    page.getByText("设计偏好已带入，请选择新的户型图。原任务和原图仍保留。"),
  ).toBeVisible();
  await examples.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await examples.scrollIntoViewIfNeeded();
  await expect(examples).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${output}/mobile.png` });
  await page.getByRole("button", { name: /使用示例户型/ }).click();
  await expect(page.getByLabel("设计要求", { exact: false })).toHaveValue(
    job.options.notes,
  );
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
  console.log(
    "通过：原图拒绝回退、换图保留偏好、四项正反示例、移动端布局；未写入用户任务。",
  );
} catch (e) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(
    `${output}/failure.txt`,
    await page.locator("body").innerText(),
  );
  throw e;
} finally {
  await browser.close();
}
