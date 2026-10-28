// Uses isolated browser responses and local fixture models; never edits user tasks.
import { expect } from "@playwright/test";
import { launchReviewBrowser } from "./browser.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { findPython } from "../python.mjs";

const root = process.cwd();
const output = path.join(root, "data/visual-review/architecture-library");
await mkdir(output, { recursive: true });
const id = "ba1c0000000000000000000000000001";
const base = process.env.STUDIO_BASE_URL || "http://127.0.0.1:5173";
const health = await (await fetch(`${base}/api/health`)).json();
let supportsOpenings = true;
const fixture = {
  title: "阳台围护验收",
  confidence: 1,
  scale_note: "固定测试结构，单位米",
  warnings: [],
  outline: [
    { x: -0.12, y: -0.12 },
    { x: 4.12, y: -0.12 },
    { x: 4.12, y: 3.12 },
    { x: -0.12, y: 3.12 },
  ],
  rooms: [
    {
      id: "balcony",
      name: "阳台",
      kind: "balcony",
      balcony_type: "open",
      polygon: [
        { x: 0.12, y: 0.12 },
        { x: 3.88, y: 0.12 },
        { x: 3.88, y: 2.88 },
        { x: 0.12, y: 2.88 },
      ],
    },
  ],
  walls: [
    {
      id: "back",
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
      height: 2.7,
      thickness: 0.16,
      exterior: true,
    },
    {
      id: "left",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 3 },
      height: 2.7,
      thickness: 0.16,
      exterior: true,
    },
    {
      id: "right",
      start: { x: 4, y: 0 },
      end: { x: 4, y: 3 },
      height: 2.7,
      thickness: 0.16,
      exterior: true,
    },
    {
      id: "front",
      start: { x: 0, y: 3 },
      end: { x: 4, y: 3 },
      height: 2.7,
      thickness: 0.16,
      exterior: true,
    },
  ],
  openings: [],
  lights: [],
  style: "natural",
  furniture: [],
};
const glass = structuredClone(fixture);
Object.assign(glass.walls[3], {
  boundary_type: "glass_railing",
  height: 1.2,
  thickness: 0.1,
  sill_height: 0.25,
});
execFileSync(
  findPython(root),
  [
    "-X",
    "utf8",
    "-c",
    `import json,sys
from pathlib import Path
from backend.app.glb_builder import Builder
from backend.app.config import Settings
from backend.app.consistency import verify_export
data=json.loads(sys.stdin.read())
for key,doc in data['models'].items():
    folder=Path(data['output'])/key
    Builder(doc,Settings().furniture_catalog).build(folder)
    assert verify_export(doc,folder/'model.glb')['geometry_verified']
`,
  ],
  {
    cwd: root,
    input: JSON.stringify({ output, models: { wall: fixture, glass } }),
    stdio: ["pipe", "pipe", "pipe"],
  },
);
const originalModel = await readFile(path.join(output, "wall/model.glb"));
const glassModel = await readFile(path.join(output, "glass/model.glb"));
const job = {
  id,
  name: "阳台围护验收",
  status: "succeeded",
  created_at: "2026-10-27T12:00:00Z",
  updated_at: "2026-10-27T12:00:00Z",
  source_url: `/api/jobs/${id}/source`,
  result: {
    revision: "fixture-1",
    warnings: [],
    model_url: `/api/jobs/${id}/model.glb`,
    layout_url: `/api/jobs/${id}/artifacts/layout.json`,
  },
};
const browser = await launchReviewBrowser();
const errors = [],
  checks = [],
  previews = [],
  unexpectedWrites = [];
let draft = null,
  draftRevision = 0;
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      p = url.pathname;
    const json = (value) => route.fulfill({ json: value });
    if (p === "/api/health")
      return json({
        ...health,
        capabilities: [
          ...(health.capabilities || []),
          ...(supportsOpenings ? ["architecture_openings"] : []),
        ],
      });
    if (p === "/api/jobs/page")
      return json({ items: [job], before: null, cursor: "fixture" });
    if (p === "/api/jobs/changes")
      return json({ items: [], cursor: "fixture", more: false });
    if (p === "/api/project-metadata") return json({ items: [] });
    if (p === `/api/jobs/${id}`) return json(job);
    if (p === `/api/jobs/${id}/timeline`) return json({ items: [] });
    if (p === `/api/jobs/${id}/events`)
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": fixture\n\n",
      });
    if (p === `/api/jobs/${id}/artifacts/layout.json`) return json(fixture);
    if (p === `/api/jobs/${id}/model.glb`)
      return route.fulfill({
        contentType: "model/gltf-binary",
        body: originalModel,
      });
    if (p.startsWith("/api/drafts/")) {
      if (request.method() === "POST") {
        draft = request.postDataJSON().document;
        draftRevision++;
      }
      return json({
        document: draft,
        revision: draftRevision,
        updated_at: "2026-10-27T12:00:00Z",
      });
    }
    if (p === "/api/design/check") return json({ valid: true, issues: [] });
    if (p === `/api/jobs/${id}/preview`) {
      const value = request.postDataJSON();
      previews.push(value);
      execFileSync(
        findPython(root),
        [
          "-X",
          "utf8",
          "-c",
          `import json,sys
from pathlib import Path
from backend.app.glb_builder import Builder
from backend.app.config import Settings
from backend.app.consistency import verify_export
data=json.loads(sys.stdin.read());folder=Path(data['output'])/'current'
doc={**data['body']['layout'],'style':'natural','furniture':data['body']['furniture']['items']}
Builder(doc,Settings().furniture_catalog).build(folder)
assert verify_export(doc,folder/'model.glb')['geometry_verified']
`,
        ],
        {
          cwd: root,
          input: JSON.stringify({ output, body: value }),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      return route.fulfill({
        contentType: "model/gltf-binary",
        body: await readFile(path.join(output, "current/model.glb")),
      });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      unexpectedWrites.push(`${request.method()} ${p}`);
      return route.fulfill({
        status: 409,
        json: { detail: "隔离验收禁止其他写入" },
      });
    }
    return route.continue();
  });
  await page.goto(`${base}/?project=${id}&assetType=architecture#library`);
  await expect(
    page.getByRole("button", { name: "建筑构件", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("建筑构件列表").getByRole("button")).toHaveCount(
    17,
  );
  await expect(page.getByLabel("建筑构件列表").locator("img")).toHaveCount(17);
  await expect(
    page.getByLabel("阳台玻璃栏板可旋转三维预览").locator("canvas"),
  ).toBeVisible();
  await page.getByLabel("建筑构件应用墙段").selectOption("front");
  await page.getByLabel("构件围护总高").fill("1.2");
  await page.getByLabel("构件实体基座高度").fill(".25");
  await expect(
    page.getByRole("button", { name: "应用到选中墙段", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: path.join(output, "library-desktop.png") });
  checks.push(
    "素材库链接直达五类 17 种建筑构件，缩略图不占用常驻 WebGL 上下文，旋转预览和参数可用",
  );
  const previewCanvas = page
    .getByLabel("阳台玻璃栏板可旋转三维预览")
    .locator("canvas");
  const rect = await previewCanvas.boundingBox();
  await page.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.3, rect.y + rect.height * 0.6, {
    steps: 6,
  });
  await page.mouse.up();
  await page
    .getByRole("button", { name: "应用到选中墙段", exact: true })
    .click();
  await expect(page.getByLabel("围护形式")).toHaveValue("glass_railing");
  await expect(page.getByText(/围护总高 1.20/)).toBeVisible();
  await expect.poll(() => previews.length).toBeGreaterThan(0);
  const applied = previews.find(
    (p) => p.layout.walls[3].boundary_type === "glass_railing",
  );
  expect(applied.layout.walls[3].sill_height).toBe(0.25);
  expect(applied.layout.walls[0].height).toBe(2.7);
  await expect(page.locator(".scene-editor-canvas canvas")).toBeVisible();
  await page.screenshot({ path: path.join(output, "applied.png") });
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await page
    .getByRole("button", { name: "墙体 4 · 外墙 基础饰面", exact: true })
    .click();
  await expect(page.getByLabel("围护形式")).toHaveValue("wall");
  checks.push("从素材库应用到指定墙段，进入三维草稿，保留相邻实墙且支持撤销");
  await page
    .getByRole("button", { name: "从建筑构件库选择", exact: true })
    .click();
  await page
    .getByLabel("建筑构件分类")
    .getByRole("button", { name: /^门/ })
    .click();
  await expect(page.getByLabel("建筑构件列表").getByRole("button")).toHaveCount(
    4,
  );
  await page
    .getByLabel("建筑构件列表")
    .getByRole("button", { name: /^双开平开门/ })
    .click();
  await page
    .getByRole("button", { name: "安装到选中墙段", exact: true })
    .click();
  await expect(page.getByLabel("门扇样式")).toHaveValue("double");
  await expect
    .poll(() =>
      previews.some((p) => p.layout.openings[0]?.door_style === "double"),
    )
    .toBe(true);
  await page.screenshot({ path: path.join(output, "double-door-applied.png") });
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect.poll(() => draft?.layout.openings.length).toBe(0);
  await page.goto(`${base}/?project=${id}&assetType=architecture#library`);
  await page
    .getByLabel("建筑构件分类")
    .getByRole("button", { name: /^窗/ })
    .click();
  await expect(page.getByLabel("建筑构件列表").getByRole("button")).toHaveCount(
    5,
  );
  await page
    .getByLabel("建筑构件列表")
    .getByRole("button", { name: /^双扇平开窗/ })
    .click();
  await page.getByLabel("建筑构件应用墙段").selectOption("front");
  await page
    .getByRole("button", { name: "安装到选中墙段", exact: true })
    .click();
  await expect(page.getByLabel("窗户样式")).toHaveValue("casement");
  await page
    .getByRole("button", { name: "从建筑构件库选择门窗", exact: true })
    .click();
  await page
    .getByLabel("建筑构件分类")
    .getByRole("button", { name: /^窗/ })
    .click();
  await page
    .getByLabel("建筑构件列表")
    .getByRole("button", { name: /^双扇推拉窗/ })
    .click();
  await page.getByLabel("建筑构件安装方式").selectOption("0");
  await page.getByRole("button", { name: "替换选中开口", exact: true }).click();
  await expect(page.getByLabel("窗户样式")).toHaveValue("sliding");
  await expect
    .poll(() =>
      previews.some(
        (p) =>
          p.layout.openings.length === 1 &&
          p.layout.openings[0]?.window_style === "sliding",
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: path.join(output, "sliding-window-applied.png"),
  });
  await page
    .getByRole("button", { name: "从建筑构件库选择门窗", exact: true })
    .click();
  await page
    .getByLabel("建筑构件分类")
    .getByRole("button", { name: /^门/ })
    .click();
  await page
    .getByLabel("建筑构件列表")
    .getByRole("button", { name: /^单开平开门/ })
    .click();
  await page.getByLabel("构件距墙起点").fill(".1");
  await expect(
    page.getByRole("alert").filter({ hasText: "重叠" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "安装到选中墙段", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("建筑构件分类")
    .getByRole("button", { name: /^通道/ })
    .click();
  await page
    .getByLabel("建筑构件列表")
    .getByRole("button", { name: /^宽开放通道/ })
    .click();
  await page
    .getByRole("button", { name: "安装到选中墙段", exact: true })
    .click();
  await expect
    .poll(() =>
      previews.some(
        (p) =>
          p.layout.openings.length === 2 &&
          p.layout.openings[1].kind === "passage",
      ),
    )
    .toBe(true);
  checks.push(
    "门、窗、通道分类可筛选；双开门安装、窗口替换、开口避让、重叠拦截和真实 GLB 生成通过",
  );
  supportsOpenings = false;
  await page.goto(`${base}/?project=${id}&assetType=architecture#library`);
  await page
    .getByLabel("建筑构件分类")
    .getByRole("button", { name: /^门/ })
    .click();
  await page
    .getByLabel("建筑构件列表")
    .getByRole("button", { name: /^单开平开门/ })
    .click();
  await page.getByLabel("建筑构件应用墙段").selectOption("back");
  await expect(page.getByText(/新增门窗样式需要重启项目后端/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "安装到选中墙段", exact: true }),
  ).toBeDisabled();
  supportsOpenings = true;
  checks.push("旧后端保留样板浏览并提示重启，阻止发送不兼容的门窗参数");
  await page.goto(`${base}/?project=sample&assetType=architecture#library`);
  await expect(page.getByText(/现在可以先浏览、旋转和调整样板/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("搜索建筑构件").fill("封窗");
  await expect(page.getByLabel("建筑构件列表").getByRole("button")).toHaveCount(
    1,
  );
  await page.getByLabel("建筑构件列表").getByRole("button").click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(output, "library-mobile.png"),
    fullPage: true,
  });
  checks.push("示例模式可浏览但不能改写墙段，手机搜索及布局无横向溢出");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole("button", { name: "装修材质", exact: true }).click();
  await page.getByRole("button", { name: /浅米大理石纹墙砖 仿石瓷砖/ }).click();
  await expect(
    page.locator(".material-inspector .architecture-preview canvas"),
  ).toBeVisible();
  await page.screenshot({ path: path.join(output, "material-wall.png") });
  checks.push("墙面材质详情以可旋转的真实三维墙段展示");
  expect(errors).toEqual([]);
  expect(unexpectedWrites).toEqual([]);
  const report = { checks, errors, unexpectedWrites };
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
