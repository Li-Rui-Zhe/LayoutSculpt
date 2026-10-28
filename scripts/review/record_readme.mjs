// 录制公开示例与模板；拦截私人数据、凭据和写请求，不调用 AI。
import { expect as baseExpect } from "@playwright/test";
import { launchReviewBrowser } from "./browser.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 120000 });
const base = process.env.STUDIO_BASE_URL || "http://127.0.0.1:8000";
const output = path.resolve("data/readme-recording");
await mkdir(output, { recursive: true });
const browser = await launchReviewBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(90000);
const errors = [], writes = [], drafts = new Map(), manifest = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/api/**", async (route) => {
  const request = route.request(), url = new URL(request.url()), p = url.pathname;
  const json = (value) => route.fulfill({ json: value });
  if (p === "/api/health") return json({ status: "ok", ai: { provider: "deepseek", deepseek_configured: false }, codex: { connected: false }, furniture_library: { available: true } });
  if (p === "/api/client-access") return json({ application: "layoutsculpt", protocol: 1, origin: new URL(base).origin, write_allowed: true });
  if (p === "/api/jobs" || p === "/api/jobs/page" || p === "/api/jobs/changes") return json({ items: [], cursor: "recording", more: false });
  if (p === "/api/diy/assets" || p === "/api/materials") return json({ items: [] });
  if (p.startsWith("/api/drafts/")) {
    if (request.method() === "POST") drafts.set(p, { document: request.postDataJSON().document, revision: (drafts.get(p)?.revision || 0) + 1 });
    return json(drafts.get(p) || { document: null, revision: 0 });
  }
  if (p === "/api/ai/settings") return json({ revision: 0, default_provider: "deepseek", warning: null,
    deepseek: { configured: false, default_model: null, key_hint: null },
    codex: { available: false, system_available: false, managed: false, environment: "shared", connected: false, default_model: null, runtime: null } });
  if (p === "/api/models") return json({ provider: "deepseek", items: [], default_model: null, configured_default: false });
  if (p === "/api/ai/codex/login") return json({ status: "idle" });
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
    writes.push(p); return route.fulfill({ status: 409, json: { detail: "演示录制不提交真实任务" } });
  }
  return route.continue();
});
async function capture(name, label, frames, duration = 1400) {
  const file = path.join(output, `${name}-${String(frames.length).padStart(3, "0")}.png`);
  await page.screenshot({ path: file });
  frames.push({ file, duration, label });
  await writeFile(path.join(output, `${name}.json`), JSON.stringify({ name, frames }, null, 2));
}
async function sample() {
  await page.goto(`${base}/?project=sample&tab=design`);
  await expect(page.locator("#viewport canvas")).toBeVisible({ timeout: 120000 });
  await expect(page.locator(".canvas-loading")).toHaveCount(0, { timeout: 120000 });
  await page.waitForTimeout(800);
}
async function environment(name) {
  await page.locator(".environment-trigger").click();
  await page.getByRole("button", { name: `切换到${name}`, exact: true }).click();
  await page.waitForTimeout(900);
}
const selected = process.argv[2];
try {
  if (!selected || selected === "showcase") {
    await sample(); const frames = [];
    await capture("showcase", "林间光庭 · 真实三维空间", frames);
    const box = await page.locator("#viewport canvas").boundingBox();
    const x = box.x + box.width * .5, y = box.y + box.height * .52;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 18; i++) {
      await page.mouse.move(x + i * 3, y, { steps: 2 });
      await capture("showcase", "拖动旋转 · 自由查看空间", frames, 100);
    }
    await page.mouse.up();
    await capture("showcase", "拖动旋转 · 自由查看空间", frames, 1200);
    await environment("日落"); await capture("showcase", "日落 · 温暖斜阳", frames, 1800);
    await environment("夜晚"); await capture("showcase", "夜晚 · 查看灯光与空间氛围", frames, 2000);
    await environment("晴天");
    await page.getByRole("button", { name: "俯视", exact: true }).click();
    await page.waitForTimeout(800); await capture("showcase", "俯视 · 一览房间与动线", frames, 1800);
    manifest.push({ name: "showcase", frames });
  }
  if (!selected || selected === "materials") {
    await sample(); const frames = [];
    await page.getByRole("button", { name: "外观设置", exact: true }).click();
    await expect(page.locator(".material-dock")).toBeVisible();
    await capture("materials", "墙面与地板 · 点击样板预览", frames);
    const walls = page.locator("#dock-materials .swatch");
    for (const index of [1, 3]) {
      await walls.nth(index).click(); await page.waitForTimeout(700);
      await capture("materials", "更换墙面饰面 · 保留原有空间布局", frames, 1700);
    }
    await page.getByRole("tab", { name: "地板", exact: true }).click();
    await page.getByLabel("地板应用区域").selectOption("living");
    await page.locator("#dock-materials .swatch").nth(1).click();
    await page.waitForTimeout(700); await capture("materials", "只更换客厅地板 · 各房间独立铺设", frames, 2000);
    await page.getByRole("button", { name: "还原材质", exact: true }).click();
    await capture("materials", "随时还原 · 方案仍可继续调整", frames, 1500);
    manifest.push({ name: "materials", frames });
  }
  if (!selected || selected === "diy") {
    await page.goto(`${base}/#diy`); const frames = [];
    await page.locator(".diy-templates").getByRole("button", { name: "玄关柜", exact: true }).click();
    await expect(page.locator(".diy-preview-wrap canvas")).toBeVisible();
    await page.waitForTimeout(800);
    await capture("diy", "家具 DIY · 从玄关柜模板开始", frames);
    await page.locator(".diy-finish-panel summary").click();
    await page.getByLabel("饰面应用范围").selectOption("all");
    await page.locator(".diy-finish-grid button").nth(2).click();
    await capture("diy", "整件家具换饰面 · 保留可编辑部件", frames, 1800);
    const box = await page.locator(".diy-preview-wrap canvas").boundingBox();
    const x = box.x + box.width * .5, y = box.y + box.height * .5;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 14; i++) {
      await page.mouse.move(x + i * 4, y, { steps: 2 });
      await capture("diy", "旋转查看 · 调整部件与尺寸", frames, 100);
    }
    await page.mouse.up();
    await page.getByRole("button", { name: "撤销 DIY 修改", exact: true }).click();
    await capture("diy", "撤销饰面修改 · 不调用 AI 的模板编辑", frames, 1700);
    manifest.push({ name: "diy", frames });
  }
  if (!selected || selected === "ai-connections") {
    await page.goto(`${base}/#ai`); const frames = [];
    await expect(page.getByLabel("DeepSeek API Key", { exact: true })).toBeVisible();
    await capture("ai-connections", "DeepSeek API · 填写密钥即可检测并接入", frames, 2400);
    await page.locator(".ai-provider-card").filter({ hasText: "Codex" }).click();
    await capture("ai-connections", "Codex · 复用本机，或准备项目独立环境", frames, 2400);
    await page.locator(".ai-provider-card").filter({ hasText: "DeepSeek" }).click();
    await capture("ai-connections", "按模型能力使用 · 此演示不输入密钥、不发起生成", frames, 2000);
    manifest.push({ name: "ai-connections", frames });
  }
  expect(errors).toEqual([]); expect(writes).toEqual([]);
  for (const entry of manifest) await writeFile(path.join(output, `${entry.name}.json`), JSON.stringify(entry, null, 2));
  console.log(JSON.stringify({ recorded: manifest.map((entry) => [entry.name, entry.frames.length]), errors, writes }));
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  throw error;
} finally { await browser.close(); }
