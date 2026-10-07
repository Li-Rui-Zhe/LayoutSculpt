import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const id = process.argv[2];
if (!/^[a-f0-9]{32}$/.test(id || ""))
  throw new Error("请提供已有成功任务 ID。");
const output = "data/visual-review/delivery-notice";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [],
  checks = [],
  mutations = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1050 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const snapshot = await (
    await page.request.get(`http://127.0.0.1:8000/api/jobs/${id}`)
  ).json();
  expect(snapshot.status).toBe("succeeded");
  const fixture = structuredClone(snapshot);
  fixture.updated_at = "2099-01-01T00:00:00Z";
  fixture.result.delivery_status = "structure_ready";
  fixture.result.delivery_notice =
    "家具规划超时，已先生成确认的房屋结构；家具尚未完成，可手动布置或重新规划家具。";
  await page.route("**/api/**", (route) => {
    if (!["GET", "HEAD"].includes(route.request().method())) {
      mutations.push(route.request().url());
      return route.abort();
    }
    return route.fallback();
  });
  await page.route(`**/api/jobs/${id}`, (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.route("**/api/jobs", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.items = json.items.map((job) => (job.id === id ? fixture : job));
    await route.fulfill({ json });
  });
  await page.addInitScript(
    (jobId) => localStorage.setItem("habitat-job", jobId),
    id,
  );
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator("#viewport canvas")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".delivery-notice")).toContainText("家具尚未完成");
  await page.getByRole("button", { name: "完善家具", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "改进当前方案", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${output}/desktop.png` });
  checks.push("交付结构时明确说明家具未完成，并可进入完善方案弹窗");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".delivery-notice")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "完善家具", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  checks.push("手机提示完整可读，无横向溢出，保留模型预览和手动调整入口");
  expect(errors).toEqual([]);
  expect(mutations).toEqual([]);
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ checks, errors, mutations }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors, mutations }, null, 2));
} finally {
  await browser.close();
}
