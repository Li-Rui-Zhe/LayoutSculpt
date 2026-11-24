// 从隔离质量基准服务回放已生成的合成户型，仅截取图纸和三维视口。
import { expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchReviewBrowser } from "./browser.mjs";

const [reportFile, caseName] = process.argv.slice(2);
if (!reportFile || !caseName)
  throw Error("请提供合成测试的 report.json 和案例名称");
const report = JSON.parse(await readFile(reportFile, "utf8"));
const run = report.runs.find(
  (r) => r.case === caseName && r.status === "succeeded",
);
if (!report.fixture_only || !run) throw Error("录制需要已完成的合成测试案例");
const base = process.env.STUDIO_BASE_URL || "http://127.0.0.1:8000";
const output = path.resolve(
  process.env.README_RECORDING_DIR || "data/readme-recording",
);
await mkdir(output, { recursive: true });
const manifestFile = path.join(output, "recognition.json");
await writeFile(
  manifestFile,
  JSON.stringify({ schema: 2, status: "recording" }),
);
const browser = await launchReviewBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 920 },
  });
  const job = await (
    await page.request.get(base + "/api/jobs/" + run.job)
  ).json();
  expect(job.id).toBe(run.job);
  expect(job.name).toBe("隔离质量验收 " + caseName);
  expect(job.status).toBe("succeeded");
  const source = await readFile(
    path.join(path.dirname(reportFile), "sources", caseName + ".png"),
  );
  expect(
    source.equals(await (await page.request.get(base + job.source_url)).body()),
  ).toBe(true);
  const frames = [],
    errors = [],
    blockedWrites = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    if (["GET", "HEAD"].includes(route.request().method()))
      return route.continue();
    blockedWrites.push(new URL(route.request().url()).pathname);
    return route.abort();
  });
  async function shot(target, label, duration) {
    const file = path.join(output, `recognition-${frames.length}.png`);
    await target.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: file,
      clip: await target.boundingBox(),
      animations: "disabled",
      timeout: 60000,
    });
    frames.push({ file, label, duration });
  }
  await page.goto(base + "/?project=" + job.id + "&tab=source#workspace");
  await page.getByRole("button", { name: "原图叠加", exact: true }).click();
  const overlay = page.getByRole("region", { name: "原图叠加对照" });
  const stage = overlay.locator(".source-overlay-stage");
  await expect(stage.locator("svg")).toBeVisible();
  const opacity = overlay.getByRole("slider");
  await opacity.press("Home");
  await shot(stage, "上传的合成户型原图", 1800);
  const local = overlay.getByRole("checkbox", { name: "本地墙、门、窗分割" });
  const mask = page.waitForResponse(
    (r) => r.url().endsWith("/local-floorplan-mask.png") && r.ok(),
  );
  await local.check();
  await mask;
  await shot(stage, "CPU 小模型标出墙、门和窗", 2000);
  await local.uncheck();
  await opacity.press("End");
  await overlay.getByRole("checkbox", { name: "显示房间名称" }).check();
  const passage = stage.locator("g > title").filter({ hasText: /^开放通道$/ });
  const label = (await passage.count())
    ? "最终平面 · 玫红色短虚线表示无门通道"
    : "最终平面 · 对照墙线、房间和开口";
  await shot(stage, label, 2600);
  await page.getByRole("button", { name: "设计预览", exact: true }).click();
  const canvas = page.locator("#viewport canvas");
  await expect(canvas).toHaveAttribute("data-model-url", job.result.model_url, {
    timeout: 60000,
  });
  await expect(
    page.locator(".design-panel .canvas-loading:visible"),
  ).toHaveCount(0, { timeout: 60000 });
  await shot(canvas, "同一户型自动生成的三维成品", 1600);
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x + i * 8, y, { steps: 2 });
    await shot(canvas, "旋转查看房间和开口", i === 8 ? 1400 : 110);
  }
  await page.mouse.up();
  expect(errors).toEqual([]);
  expect(blockedWrites).toEqual([]);
  await writeFile(
    manifestFile,
    JSON.stringify({
      schema: 2,
      status: "complete",
      frames,
      errors,
      blocked_writes: blockedWrites,
    }),
  );
} finally {
  await browser.close();
}
