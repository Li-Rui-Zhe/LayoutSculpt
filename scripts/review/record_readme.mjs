// Public demonstration capture. Uses authored assets and synthetic settings only.
import { expect as baseExpect } from "@playwright/test";
import { launchReviewBrowser } from "./browser.mjs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 60000 });
const base = process.env.STUDIO_BASE_URL || "http://127.0.0.1:8000";
const output = path.resolve(
  process.env.README_RECORDING_DIR || "data/readme-recording",
);
const requested = process.argv[2];
const groups = ["showcase", "materials", "furniture", "diy", "ai-connections"];
if (requested && !groups.includes(requested))
  throw Error(`请选择 ${groups.join(" / ")}`);
await mkdir(output, { recursive: true });
const showcase = JSON.parse(
  await readFile("frontend/src/showcase.json", "utf8"),
);
const furnitureCatalog = JSON.parse(
  await readFile("assets/furniture/catalog.json", "utf8"),
);
const featuredKinds = ["sofa_daybed", "desk_corner", "range_hood"];
const publicFurniture = furnitureCatalog.items
  .filter((entry) => featuredKinds.includes(entry.kind))
  .map((entry) => ({
    ...entry,
    filename: `${entry.kind}.glb`,
    source: "builtin",
    model_url: `/readme-furniture/${entry.kind}.glb`,
    thumbnail_url: `/readme-furniture/${entry.kind}.png`,
  }));
const browser = await launchReviewBrowser();
const results = [];

async function record(name) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: name === "ai-connections" ? 1240 : 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [],
    blockedWrites = [],
    drafts = new Map(),
    frames = [];
  let state = {
    revision: 1,
    default_provider: "deepseek",
    warning: null,
    deepseek: {
      configured: true,
      default_model: "demo-fast",
      key_hint: "•••• DEMO",
      key_storage: "本机加密存储",
    },
    codex: {
      available: true,
      system_available: true,
      connected: false,
      managed: false,
      environment: "shared",
      default_model: "demo-local",
      runtime: null,
    },
  };
  const catalog = (provider) => ({
    provider,
    configured_default: true,
    default_model:
      provider === "deepseek"
        ? `deepseek::${state.deepseek.default_model}`
        : "demo-local",
    items:
      provider === "deepseek"
        ? [
            {
              id: "deepseek::demo-fast",
              name: "示例模型 · 快速",
              available: true,
              supports_image: false,
              efforts: [],
            },
            {
              id: "deepseek::demo-detail",
              name: "示例模型 · 精细",
              available: true,
              supports_image: false,
              efforts: [],
            },
          ]
        : [
            {
              id: "demo-local",
              name: "本机模型 · 演示",
              available: true,
              supports_image: true,
              efforts: [],
            },
          ],
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => dialog.accept());
  await context.addInitScript(() => {
    localStorage.setItem("habitat-job", "sample");
    document.addEventListener("DOMContentLoaded", () => {
      const cursor = document.createElement("div");
      cursor.style.cssText =
        "position:fixed;left:-50px;top:-50px;width:11px;height:11px;border:2px solid #204e3d;border-radius:50%;background:#e8eee1;box-shadow:0 0 0 4px #ffffff77;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%)";
      document.body.append(cursor);
      document.addEventListener("pointermove", (e) => {
        cursor.style.left = e.clientX + "px";
        cursor.style.top = e.clientY + "px";
      });
    });
  });
  await page.route("**/readme-furniture/*", async (route) => {
    const asset = new URL(route.request().url()).pathname;
    const item = publicFurniture.find(
      (entry) => entry.model_url === asset || entry.thumbnail_url === asset,
    );
    if (!item) return route.fulfill({ status: 404 });
    const mesh = asset === item.model_url;
    const filename = mesh
      ? `glb/${item.filename}`
      : `thumbnails/${item.kind}.png`;
    return route.fulfill({
      path: `assets/furniture/${filename}`,
      contentType: mesh ? "model/gltf-binary" : "image/png",
    });
  });
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname;
    const json = (value) => route.fulfill({ json: value });
    if (p === "/api/health")
      return json({
        status: "ok",
        ai: {
          provider: "deepseek",
          deepseek_configured: name === "ai-connections",
        },
        codex: { connected: false },
        furniture_library: { available: true },
      });
    if (p === "/api/client-access")
      return json({
        application: "layoutsculpt",
        protocol: 1,
        origin: new URL(base).origin,
        write_allowed: true,
      });
    if (["/api/jobs", "/api/jobs/page", "/api/jobs/changes"].includes(p))
      return json({ items: [], cursor: "public-demo", more: false });
    if (["/api/diy/assets", "/api/materials"].includes(p))
      return json({ items: [] });
    if (p === "/api/library/assets") return json({ items: publicFurniture });
    if (p.startsWith("/api/drafts/")) {
      if (req.method() === "POST")
        drafts.set(p, {
          document: req.postDataJSON().document,
          revision: (drafts.get(p)?.revision || 0) + 1,
        });
      return json(drafts.get(p) || { document: null, revision: 0 });
    }
    if (p === "/api/ai/settings") {
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        if (body.api_key || body.remove_key)
          throw Error("公开演示不输入或移除凭据");
        state = {
          ...state,
          revision: state.revision + 1,
          default_provider: body.provider,
          [body.provider]: {
            ...state[body.provider],
            default_model: body.model.replace(/^deepseek::/, ""),
          },
        };
        return json({ ...state, catalog: catalog(body.provider) });
      }
      return json(state);
    }
    if (p === "/api/models")
      return json(
        catalog(url.searchParams.get("provider") || state.default_provider),
      );
    if (p === "/api/ai/codex/login") return json({ status: "idle" });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method())) {
      blockedWrites.push(p);
      return route.fulfill({
        status: 409,
        json: { detail: "录制不提交真实任务" },
      });
    }
    return route.continue();
  });
  const manifest = {
    schema: 2,
    name,
    status: "recording",
    model_revision: showcase.revision,
    viewport: page.viewportSize(),
    privacy:
      "authored sample; template editing; synthetic connection settings; no real AI calls",
    frames,
  };
  const saveManifest = () =>
    writeFile(
      path.join(output, `${name}.json`),
      JSON.stringify(manifest, null, 2),
    );
  await saveManifest();
  async function shot(label, duration = 1200) {
    const file = path.join(
      output,
      `${name}-${String(frames.length).padStart(3, "0")}.png`,
    );
    await page.screenshot({ path: file, animations: "disabled" });
    frames.push({ file, label, duration });
    await saveManifest();
  }
  async function sample() {
    await page.goto(`${base}/?project=sample&tab=design`);
    const canvas = page.locator("#viewport canvas");
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute(
      "data-model-url",
      new RegExp(showcase.model_url.replaceAll(".", "\\.")),
    );
    await expect(page.locator(".canvas-loading")).toHaveCount(0);
    await page.waitForTimeout(1500);
  }
  async function environment(label) {
    await page.locator(".environment-trigger").click();
    await page
      .getByRole("button", { name: `切换到${label}`, exact: true })
      .click();
    await page.waitForTimeout(700);
  }
  async function applyMaterial(name) {
    const swatch = page
      .locator("#dock-materials")
      .getByRole("button", { name: `应用${name}`, exact: true });
    await swatch.click();
    await expect(swatch).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(400);
  }
  async function orbit(label, steps = 24, distance = 60, vertical = 0) {
    const selector =
      {
        diy: ".diy-preview-wrap canvas",
        furniture: ".library-inspector canvas",
      }[name] || "#viewport canvas";
    const box = await page.locator(selector).boundingBox();
    const x = box.x + box.width * 0.52,
      y = box.y + box.height * 0.53;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
        x + (i * distance) / steps,
        y + (i * vertical) / steps,
        {
          steps: 2,
        },
      );
      await page.waitForTimeout(45);
      await shot(label, 80);
    }
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  try {
    if (name === "showcase") {
      await sample();
      await shot("林间光庭 · 日光下的全屋布局", 1000);
      await page
        .locator("#viewport canvas")
        .screenshot({ path: path.join(output, "showcase-canvas.png") });
      await orbit("轻拖旋转 · 从不同角度理解空间");
      await environment("日落");
      await shot("日落 · 更温暖的空间层次", 1100);
      await environment("夜晚");
      await shot("夜晚 · 查看分区照明与家具关系", 1500);
      await environment("晴天");
      await page
        .getByRole("combobox", { name: "定位房间" })
        .selectOption("terrace");
      await page.waitForTimeout(900);
      await shot("走近花园露台 · 细看家具与围护", 1500);
      await page.getByRole("combobox", { name: "定位房间" }).selectOption("");
      await page.getByRole("button", { name: "俯视", exact: true }).click();
      await page.waitForTimeout(700);
      await shot("切换俯视 · 看清房间与动线", 1300);
      await page.getByRole("button", { name: "三维", exact: true }).click();
      await page.waitForTimeout(600);
      await shot("回到全屋 · 继续探索你的空间", 700);
    }
    if (name === "materials") {
      await sample();
      await page.getByRole("button", { name: "外观设置", exact: true }).click();
      await expect(page.locator(".material-dock")).toBeVisible();
      await shot("保留布局 · 从原始材质开始", 1100);
      await applyMaterial("浅橡木饰面");
      await shot("浅橡木饰面 · 空间更温润", 1400);
      await applyMaterial("米灰艺术漆");
      await shot("米灰艺术漆 · 换一种墙面表情", 1400);
      await page.getByRole("tab", { name: "地板", exact: true }).click();
      await page.getByLabel("地板应用区域").selectOption("living");
      await applyMaterial("胡桃直铺");
      await shot("选中客厅 · 单独铺设胡桃木地板", 1600);
      await applyMaterial("米色洞石");
      await shot("仍是同一间客厅 · 比较洞石效果", 1600);
      await page.getByRole("button", { name: "还原材质", exact: true }).click();
      await page.waitForTimeout(350);
      await shot("随时还原 · 其他房间保持各自搭配", 1000);
    }
    if (name === "furniture") {
      await page.goto(`${base}/?project=sample&assetType=models#library`);
      const inspector = page.locator(".library-inspector");
      async function selectFurniture(kind) {
        const entry = publicFurniture.find((item) => item.kind === kind);
        await page
          .locator(".library-card")
          .filter({ hasText: entry.name })
          .click();
        await expect(inspector.locator("canvas")).toBeVisible();
        await expect(inspector.locator(".library-metadata")).toContainText(
          entry.triangles.toLocaleString("en-US"),
        );
        await expect(inspector.locator(".diy-preview-message")).not.toBeVisible(
          {
            timeout: 5000,
          },
        );
      }
      await selectFurniture("sofa_daybed");
      await shot("木架日床 · 厚布垫与后倾靠背", 1400);
      await orbit("转动查看日床 · 检查木框、布垫和靠背", 11, 64);
      await selectFurniture("desk_corner");
      await shot("L 形转角桌 · 一体木桌板与门形脚架", 1500);
      await orbit("转动查看转角桌 · 观察浅抽与承托", 11, 58);
      await selectFurniture("range_hood");
      await shot("顶吸烟机 · 查看窄面触控区和罩体", 1700);
      await orbit("转到罩体下方 · 查看进风格栅", 8, 22, -43);
    }
    if (name === "diy") {
      await page.goto(`${base}/#diy`);
      await page
        .locator(".diy-templates")
        .getByRole("button", { name: "玄关柜", exact: true })
        .click();
      await expect(page.locator(".diy-preview-wrap canvas")).toBeVisible();
      await page.waitForTimeout(1300);
      await shot("从玄关柜模板开始 · 部件保持可编辑", 1100);
      await page.locator(".diy-finish-panel summary").click();
      await page.getByLabel("饰面应用范围").selectOption("all");
      await page
        .locator(".diy-finish-grid")
        .getByRole("button", { name: "应用浅橡木", exact: true })
        .click();
      await page.waitForTimeout(400);
      await shot("浅橡木饰面 · 直接预览新的材质", 1400);
      await orbit("旋转查看 · 检查正面、侧面和细节", 18, 70);
      await page.getByRole("button", { name: "正面", exact: true }).click();
      await page.waitForTimeout(500);
      await shot("正面查看 · 检查家具比例", 1100);
      await page.getByRole("button", { name: "三维", exact: true }).click();
      await page
        .getByRole("button", { name: "撤销 DIY 修改", exact: true })
        .click();
      await page.waitForTimeout(450);
      await shot("撤销修改 · 回到上一个设计状态", 1200);
    }
    if (name === "ai-connections") {
      await page.goto(`${base}/#ai`);
      const summary = page.getByRole("region", { name: "已保存的 AI 配置" });
      const picker = page.getByRole("combobox", {
        name: "新任务默认模型",
        exact: true,
      });
      await expect(summary).toBeVisible();
      await expect(picker).toHaveValue("deepseek::demo-fast");
      await page.waitForTimeout(1800);
      await shot("示例配置 · 来源、模型与已保存状态一目了然", 1700);
      await picker.selectOption("deepseek::demo-detail");
      await page.waitForTimeout(300);
      await shot("选择新模型 · 明确提示尚未保存", 1700);
      await page
        .getByRole("button", { name: "保存并使用 DeepSeek API", exact: true })
        .click();
      await expect(summary.locator(".ai-saved-model")).toHaveText(
        "示例模型 · 精细",
      );
      await page.waitForTimeout(1800);
      await shot("保存后的示例状态 · 当前模型与选择保持一致", 1900);
      await page
        .locator(".ai-provider-card")
        .filter({ hasText: "Codex" })
        .click();
      await page.waitForTimeout(600);
      await shot("Codex 入口 · 按需复用本机或管理独立环境", 1800);
    }
    expect(errors).toEqual([]);
    expect(blockedWrites).toEqual([]);
    manifest.status = "complete";
    manifest.errors = errors;
    manifest.blocked_writes = blockedWrites;
    await saveManifest();
    results.push({ name, frames: frames.length });
    console.log(
      JSON.stringify({ name, frames: frames.length, errors, blockedWrites }),
    );
  } catch (error) {
    manifest.status = "failed";
    manifest.errors = [...errors, error.message];
    await saveManifest();
    await page
      .screenshot({ path: path.join(output, `${name}-failure.png`) })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
try {
  for (const name of requested ? [requested] : groups) await record(name);
} finally {
  await browser.close();
}
