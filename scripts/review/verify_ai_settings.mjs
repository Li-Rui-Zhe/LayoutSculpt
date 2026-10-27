// Exercises settings persistence with synthetic credentials; never writes to the real service.
import { expect } from "@playwright/test";
import { launchReviewBrowser } from "./browser.mjs";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.STUDIO_BASE_URL || "http://127.0.0.1:5173";
const output = "data/visual-review/ai-settings";
await mkdir(output, { recursive: true });
const browser = await launchReviewBrowser();
const errors = [],
  checks = [],
  blockedWrites = [];
let state = {
  revision: 1,
  default_provider: "deepseek",
  warning: null,
  deepseek: {
    configured: true,
    default_model: "example-flash",
    key_hint: "•••• DEMO",
    key_storage: "本机加密存储",
  },
  codex: {
    available: true,
    system_available: true,
    managed: false,
    environment: "shared",
    connected: true,
    default_model: "local-choice",
    runtime: null,
  },
};
let failCatalog = false;
let omitSelected = false;
let forceConflict = false;
const catalog = (provider) => {
  const value = {
    provider,
    configured_default: true,
    default_model:
      provider === "deepseek"
        ? `deepseek::${state.deepseek.default_model}`
        : "local-choice",
    items:
      provider === "deepseek"
        ? [
            {
              id: "deepseek::example-flash",
              name: "Example Flash",
              supports_image: false,
              available: true,
              efforts: [],
            },
            {
              id: "deepseek::example-pro",
              name: "Example Pro",
              supports_image: true,
              available: true,
              efforts: [],
            },
          ]
        : [
            {
              id: "local-choice",
              name: "Local Choice",
              supports_image: true,
              available: true,
              efforts: [],
            },
          ],
  };
  if (omitSelected && provider === "deepseek") {
    value.items = value.items.filter(
      (item) => item.id !== "deepseek::example-pro",
    );
    value.default_model = "deepseek::example-flash";
  }
  return value;
};
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    const fulfill = (json) => route.fulfill({ json });
    if (path === "/api/client-access")
      return fulfill({
        application: "layoutsculpt",
        protocol: 1,
        origin: new URL(base).origin,
        write_allowed: true,
      });
    if (path === "/api/ai/settings" && method === "GET") return fulfill(state);
    if (path === "/api/models") {
      if (failCatalog)
        return route.fulfill({
          status: 503,
          json: { detail: "测试：模型目录暂时不可用" },
        });
      return fulfill(
        catalog(url.searchParams.get("provider") || state.default_provider),
      );
    }
    if (path === "/api/ai/test")
      return fulfill({
        provider: request.postDataJSON().provider,
        catalog: catalog(request.postDataJSON().provider),
      });
    if (path === "/api/ai/settings" && method === "POST") {
      const body = request.postDataJSON();
      if (forceConflict) {
        forceConflict = false;
        state = structuredClone(state);
        state.revision++;
        state.deepseek.default_model = "example-flash";
        return route.fulfill({
          status: 409,
          json: { detail: "连接设置已在其他页面更新" },
        });
      }
      expect(body.revision).toBe(state.revision);
      state = structuredClone(state);
      state.revision++;
      if (body.remove_key) {
        state.default_provider = "codex";
        state.deepseek = {
          ...state.deepseek,
          configured: false,
          key_hint: null,
          default_model: null,
        };
      } else {
        state.default_provider = body.provider;
        state[body.provider].default_model = (
          body.model || catalog(body.provider).default_model
        ).replace(/^deepseek::/, "");
        if (body.api_key)
          state.deepseek = {
            ...state.deepseek,
            configured: true,
            key_hint: "•••• NEW1",
          };
      }
      return fulfill({
        ...state,
        catalog: body.remove_key ? null : catalog(body.provider),
      });
    }
    if (path === "/api/jobs" && method === "GET") return fulfill({ items: [] });
    if (path.includes("/drafts/"))
      return fulfill({ document: null, revision: 0, updated_at: null });
    if (path === "/api/ai/codex/login") return fulfill({ status: "idle" });
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      blockedWrites.push(path);
      return route.fulfill({
        status: 409,
        json: { detail: "隔离验收不修改本机数据" },
      });
    }
    return route.continue();
  });
  await page.goto(base + "/#ai");
  const summary = page.getByRole("region", { name: "已保存的 AI 配置" });
  const picker = page.getByRole("combobox", {
    name: "新任务默认模型",
    exact: true,
  });
  await expect(summary).toBeVisible();
  await expect(summary.locator(".ai-saved-model")).toHaveText("Example Flash");
  await expect(summary).toContainText("已保存");
  await expect(summary).toContainText("•••• DEMO");
  await expect(picker).toHaveValue("deepseek::example-flash");
  await expect(
    page.getByLabel("DeepSeek API Key", { exact: true }),
  ).toHaveValue("");
  await page.screenshot({ path: output + "/saved-desktop.png" });
  checks.push("重新进入时显示保存的来源、具体模型、脱敏密钥，并回填模型选择");

  await picker.selectOption("deepseek::example-pro");
  await expect(summary.locator(".ai-saved-model")).toHaveText("Example Flash");
  await expect(page.locator(".ai-unsaved-note")).toContainText("尚未保存");
  await page.getByRole("button", { name: "刷新模型", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "刷新模型", exact: true }),
  ).toBeEnabled();
  await expect(picker).toHaveValue("deepseek::example-pro");
  await expect(summary.locator(".ai-saved-model")).toHaveText("Example Flash");
  await page.screenshot({ path: output + "/pending-desktop.png" });
  checks.push(
    "刷新目录与连接测试不会覆盖用户选中的模型，也不会提前改变生效配置",
  );

  await page
    .getByRole("button", { name: "保存并使用 DeepSeek API", exact: true })
    .click();
  await expect(summary.locator(".ai-saved-model")).toHaveText("Example Pro");
  await expect(picker).toHaveValue("deepseek::example-pro");
  await expect(page.locator(".ai-unsaved-note")).toHaveCount(0);
  await page.reload();
  await expect(summary.locator(".ai-saved-model")).toHaveText("Example Pro");
  await expect(picker).toHaveValue("deepseek::example-pro");
  checks.push("保存非目录默认模型后，成功响应与重新打开都保持真正保存的模型");

  const input = page.getByLabel("DeepSeek API Key", { exact: true });
  await input.fill("not-a-real-credential-for-browser-test");
  await expect(summary).toContainText("•••• DEMO");
  await expect(page.locator(".ai-unsaved-note")).toBeVisible();
  await page
    .getByRole("button", { name: "保存并使用 DeepSeek API", exact: true })
    .click();
  await expect(summary).toContainText("•••• NEW1");
  await expect(input).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(
    "not-a-real-credential-for-browser-test",
  );
  checks.push("更换密钥前保留旧标识，保存后更新脱敏标识并清空明文输入");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".ai-connections").evaluate((el) => {
    el.scrollTop = 0;
  });
  await summary.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1800);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: output + "/saved-mobile.png" });
  checks.push("手机能看见保存状态、模型名称和密钥标识，无横向溢出");

  await page.setViewportSize({ width: 1600, height: 1100 });
  omitSelected = true;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "保存并使用 DeepSeek API", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".ai-catalog-error")).toContainText(
    "所选模型未在当前目录中找到",
  );
  await page.getByRole("button", { name: "刷新模型", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "刷新模型", exact: true }),
  ).toBeEnabled();
  await expect(picker).toHaveValue("deepseek::example-pro");
  checks.push(
    "目录中缺少已选模型时保留原选择并提示确认，刷新不会静默改成别的模型",
  );
  omitSelected = false;
  failCatalog = true;
  await page.reload();
  await expect(page.locator(".ai-catalog-error")).toContainText(
    "模型目录暂时不可用",
  );
  await expect(picker).toHaveValue("deepseek::example-pro");
  await expect(summary).toContainText("•••• NEW1");
  await expect(summary.locator(".ai-saved-model")).toHaveText("example-pro");
  checks.push("模型目录暂不可用时仍展示保存的模型与密钥，不退回模糊的自动选择");
  failCatalog = false;
  await page.reload();
  await expect(picker).toHaveValue("deepseek::example-pro");
  await picker.selectOption("deepseek::example-flash");
  forceConflict = true;
  await page
    .getByRole("button", { name: "保存并使用 DeepSeek API", exact: true })
    .click();
  await expect(summary).toContainText("上次读取的配置");
  await expect(summary).toContainText("请重新读取确认");
  await page.getByRole("button", { name: "重新读取状态", exact: true }).click();
  await expect(summary.locator(".ai-saved-model")).toHaveText("Example Flash");
  await expect(picker).toHaveValue("deepseek::example-flash");
  checks.push("保存冲突时不把旧快照冒充当前生效配置，重新读取后显示真实配置");
  await page.getByText("密钥管理", { exact: true }).click();
  await page.getByRole("button", { name: "确认移除密钥", exact: true }).click();
  await expect(summary.locator(".ai-saved-key")).toContainText("未配置");
  await expect(summary).not.toContainText("•••• NEW1");
  await expect(picker).toHaveValue("local-choice");
  checks.push("移除密钥后清除旧标识，切回已保存的 Codex 模型");
  expect(errors).toEqual([]);
  expect(blockedWrites).toEqual([]);
  await writeFile(
    output + "/report.json",
    JSON.stringify(
      {
        checks,
        errors,
        blockedWrites,
        credentials: "synthetic only; no real settings writes",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors, blockedWrites }, null, 2));
} finally {
  await browser.close();
}
