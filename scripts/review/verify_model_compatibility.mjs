import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const id = process.argv[2];
if (!/^[a-f0-9]{32}$/.test(id || "")) throw Error("请提供失败任务 ID。");
const submit = process.argv.includes("--retry");
const output = "data/visual-review/model-compatibility";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const report = { checks: [], errors: [], retried: null };
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.addInitScript(
    (jobId) => localStorage.setItem("habitat-job", jobId),
    id,
  );
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".activity-page .form-error")).toContainText(
    "当前本地 Codex 登录不支持模型",
  );
  await page.getByRole("button", { name: "新建生成任务", exact: true }).click();
  const model = page.locator("#project-model"),
    effort = page.locator("#project-effort");
  await expect(model).toBeEnabled();
  await model.selectOption("gpt-6.1-sol");
  await expect(effort).toBeEnabled();
  const values = await effort
    .locator("option")
    .evaluateAll((items) => items.map((item) => item.value));
  expect(values).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
  await effort.selectOption("high");
  report.checks.push("新任务的 gpt-6.1-sol 提供完整档位，可选择 high");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "新建重试任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "选择模型并重试" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("生成模型")).toBeEnabled();
  await dialog.getByLabel("生成模型").selectOption("gpt-6.1-sol");
  await dialog.getByLabel("推理强度").selectOption("high");
  await page.screenshot({ path: `${output}/retry-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole("button", { name: "创建重试任务", exact: true }),
  ).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: `${output}/retry-mobile.png` });
  report.checks.push("失败任务可选择新模型和档位重试，桌面与小屏弹窗均可使用");
  if (submit) {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/jobs/${id}/retry`) &&
        r.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "创建重试任务", exact: true })
      .click();
    const result = await response;
    expect(result.status()).toBe(201);
    const job = await result.json();
    expect(job.id).not.toBe(id);
    expect(job.options.model).toBe("gpt-6.1-sol");
    expect(job.options.reasoning_effort).toBe("high");
    report.retried = job.id;
    await expect(dialog).toBeHidden();
    report.checks.push(
      "真实重试 API 已创建独立任务，并保存 gpt-6.1-sol / high",
    );
  }
  expect(report.errors).toEqual([]);
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
