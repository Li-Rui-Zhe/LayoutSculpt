import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { launchReviewBrowser } from "./browser.mjs";

const base = process.env.REVIEW_URL;
if (!base)
  throw new Error(
    "请通过 node scripts/prelaunch.mjs --source-evidence 启动隔离验收",
  );
const output = "data/visual-review/source-evidence";
await mkdir(output, { recursive: true });
const browser = await launchReviewBrowser();
const checks = [],
  errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("button", { name: "新建生成任务", exact: true }).click();
  await expect(page.getByRole("radio", { name: /精细识别/ })).toBeChecked();
  await page.getByRole("button", { name: /使用示例户型/ }).click();
  const submitted = page.waitForResponse(
    (r) => r.url().endsWith("/api/jobs") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "创建并开始生成", exact: true })
    .click();
  const job = await (await submitted).json();
  expect(job.options.recognition_mode).toBe("precise");
  const review = page.locator(".structure-review");
  await expect(review).toBeVisible({ timeout: 30000 });
  await expect(review).toContainText("独立读图与当前结果存在差异");
  const paused = await (
    await page.request.get(`${base}/api/jobs/${job.id}`)
  ).json();
  expect(paused.status).toBe("awaiting_review");
  expect(paused.result.ai_review.status).toBe("needs_review");
  await review.getByRole("button", { name: "原图叠加", exact: true }).click();
  const overlay = page.getByRole("region", { name: "原图叠加对照" });
  await expect(
    overlay.getByRole("img", { name: "原图上的识别墙线和对照位置" }),
  ).toBeVisible();
  const metadata = await (
    await page.request.get(base + paused.result.source_alignment_url)
  ).json();
  expect(
    Number(await overlay.locator("svg line").first().getAttribute("x1")),
  ).toBeCloseTo(metadata.origin_px[0]);
  const opacity = overlay.getByRole("slider", { name: "识别线透明度" });
  await opacity.focus();
  await opacity.press("Home");
  for (let i = 0; i < 5; i++) await opacity.press("ArrowRight");
  await expect(opacity).toHaveValue("0.25");
  await expect(overlay.locator("svg > g")).toHaveAttribute("opacity", "0.25");
  await overlay.getByRole("checkbox", { name: "显示房间名称" }).check();
  await expect(overlay.locator("svg text")).toHaveCount(1);
  await overlay.scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + "/overlay-desktop.png" });
  checks.push("精细识别分步执行，独立复核差异阻止自动建模并展示原图叠加");
  checks.push("统一像素映射、透明度调节、房间名称及对照提示正确显示");
  await page.setViewportSize({ width: 390, height: 844 });
  await overlay.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: output + "/overlay-mobile.png" });
  await page.reload();
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "原图叠加", exact: true }).click();
  await expect(overlay.locator("svg")).toBeVisible();
  checks.push("手机无横向溢出，刷新后候选、定位数据与差异状态均保留");
  await review
    .getByRole("button", { name: "已核对，继续生成", exact: true })
    .click();
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
  expect(final.result.consistency.geometry_verified).toBe(true);
  expect(final.result.consistency.source_reviewed).toBe(true);
  expect(final.result.source_alignment_url).toBeTruthy();
  checks.push("用户确认后才生成真实 GLB，最终成果保留原图定位记录");
  const old = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  old.on("pageerror", (e) => errors.push(e.message));
  await old.route("**/api/health", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        codex: { connected: true },
        capabilities: ["custom_style"],
        furniture_library: { available: true },
      },
    }),
  );
  await old.goto(base);
  await old.getByRole("button", { name: "新建生成任务", exact: true }).click();
  await old.getByRole("button", { name: /使用示例户型/ }).click();
  await expect(
    old.getByRole("button", { name: "创建并开始生成", exact: true }),
  ).toBeDisabled();
  await expect(
    old.getByText("当前运行的工作台尚未支持精细识别", { exact: false }),
  ).toBeVisible();
  await old.getByRole("radio", { name: /快速识别/ }).check();
  await expect(
    old.getByRole("button", { name: "创建并开始生成", exact: true }),
  ).toBeEnabled();
  checks.push("旧后端不误报支持精细识别，可明确选择快速模式继续");
  expect(errors).toEqual([]);
  await writeFile(
    output + "/report.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }));
} finally {
  await browser.close();
}
