// Uses isolated browser responses and local fixture models; never edits user tasks.
import { expect as baseExpect } from "@playwright/test";
import { launchReviewBrowser } from "./browser.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { findPython } from "../python.mjs";

const root = process.cwd();
const expect = baseExpect.configure({ timeout: 30000 });
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
  saves = [],
  unexpectedWrites = [];
let draft = null,
  draftRevision = 0;
const otherDrafts = new Map();
let page;
try {
  page = await browser.newPage({
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
          ...(health.capabilities || []).filter(
            (value) => value !== "architecture_openings",
          ),
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
    if (p === `/api/jobs/${id}/edit` && request.method() === "POST") {
      saves.push(request.postDataJSON());
      return json(job);
    }
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
      if (decodeURIComponent(p) !== `/api/drafts/edit:${id}`) {
        if (request.method() === "POST") {
          const previous = otherDrafts.get(p);
          otherDrafts.set(p, {
            document: request.postDataJSON().document,
            revision: (previous?.revision || 0) + 1,
          });
        }
        return json(otherDrafts.get(p) || { document: null, revision: 0 });
      }
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
  await expect(
    page.getByRole("button", { name: "平面设计", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "三维设计", exact: true }).click();
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
  await page.goto(`${base}/?project=${id}&assetType=architecture#library`);
  await page.getByLabel("建筑构件应用墙段").selectOption("front");
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
  await page.getByRole("button", { name: "三维设计", exact: true }).click();
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
  await page.getByRole("button", { name: "三维设计", exact: true }).click();
  await page.getByLabel("更换构件款式").selectOption("sliding_window");
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
  await page.goto(`${base}/?project=${id}&assetType=architecture#library`);
  await page.getByLabel("建筑构件应用墙段").selectOption("front");
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
  await page.getByRole("button", { name: "三维设计", exact: true }).click();
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
    "门、窗、通道分类可筛选；双开门安装、画布内直接换窗、开口避让、重叠拦截和真实 GLB 生成通过",
  );
  // Exercise both placement gestures through the UI; use only the isolated task.
  const plan = page.getByLabel("人工设计平面图", { exact: true });
  const placementBar = page.getByRole("region", {
    name: "建筑构件放置",
    exact: true,
  });
  const planPoint = async (x, y) =>
    plan.evaluate(
      (svg, p) => {
        const screen = new DOMPoint(p.x, p.y).matrixTransform(
          svg.getScreenCTM(),
        );
        return { x: screen.x, y: screen.y };
      },
      { x, y },
    );
  const openPlacement = async (name, view) => {
    await page.getByRole("button", { name: `${view}设计`, exact: true }).click();
    const category = /门|窗/.test(name) ? "门窗" : /通道/.test(name) ? "通道" : "墙体";
    await page.locator(".edit-tool-tabs").getByRole("button", { name: category, exact: true }).click();
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await page.getByLabel("选择建筑构件", { exact: true }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await expect(placementBar).toBeVisible();
    await expect(page.locator(".edit-history").getByRole("button", { name: "建筑构件", exact: true })).toHaveCount(0);
  };
  await openPlacement("半高隔墙", "平面");
  const center = await planPoint(2, 1.5);
  await page.mouse.move(center.x, center.y);
  await expect(placementBar).toHaveAttribute("data-valid", "true");
  await page.getByRole("button", { name: "取消放置", exact: true }).click();
  await expect(placementBar).toHaveCount(0);
  expect(draft.layout.walls).toHaveLength(4);
  await openPlacement("半高隔墙", "平面");
  await page.mouse.move(center.x, center.y);
  await expect(placementBar).toHaveAttribute("data-valid", "true");
  await placementBar
    .getByRole("button", { name: "确认放置", exact: true })
    .click();
  await expect.poll(() => draft?.layout.walls.length).toBe(5);
  expect(draft.layout.walls[4].boundary_type).toBe("parapet");
  if (!(await page.getByLabel("墙体高度", { exact: true }).isVisible()))
    await page
      .locator("summary")
      .filter({ hasText: /^墙体尺寸与位置$/ })
      .click();
  await page.getByLabel("墙体高度", { exact: true }).fill("1.4");
  await page.getByLabel("墙体高度", { exact: true }).press("Enter");
  await expect.poll(() => draft?.layout.walls[4]?.height).toBe(1.4);
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect.poll(() => draft?.layout.walls[4]?.height).toBe(1.2);
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect.poll(() => draft?.layout.walls.length).toBe(4);
  await page.getByRole("button", { name: "重做设计", exact: true }).click();
  await expect.poll(() => draft?.layout.walls.length).toBe(5);
  await openPlacement("单开平开门", "平面");
  const back = await planPoint(2, 0);
  await page.mouse.move(back.x, back.y);
  await expect(placementBar).toHaveAttribute("data-valid", "true");
  await page.mouse.click(back.x, back.y);
  await expect.poll(() => draft?.layout.openings.length).toBe(3);
  expect(draft.layout.openings[2].wall_id).toBe("back");
  await expect(
    page.getByRole("button", { name: "平面设计", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: path.join(output, "plan-placement.png") });
  checks.push(
    "平面新增墙段和贴墙安装门：候选预览、取消、确认按钮、画布点击、撤销重做均通过，保留平面视图",
  );

  await openPlacement("实体低栏板", "三维");
  const scene = page.locator(".scene-editor-canvas canvas");
  await expect(scene).toBeVisible();
  const placeScene = async (bar = placementBar) => {
    const box = await scene.boundingBox();
    for (const fy of [0.55, 0.65, 0.45, 0.75, 0.35]) {
      for (const fx of [0.5, 0.65, 0.35, 0.75, 0.25]) {
        const x = box.x + box.width * fx,
          y = box.y + box.height * fy;
        await page.mouse.move(x, y);
        if ((await bar.getAttribute("data-valid")) === "true") {
          await page.mouse.click(x, y);
          await expect(bar).toHaveCount(0);
          return;
        }
      }
    }
    throw Error(`三维没有找到可放置的位置：${await bar.innerText()}`);
  };
  await placeScene();
  await expect.poll(() => draft?.layout.walls.length).toBe(6);
  await page
    .getByRole("button", { name: "删除墙体及附着对象", exact: true })
    .click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect.poll(() => draft?.layout.walls.length).toBe(5);
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect.poll(() => draft?.layout.walls.length).toBe(6);
  await openPlacement("卫生间磨砂窗", "三维");
  await placeScene();
  await expect.poll(() => draft?.layout.openings.length).toBe(4);
  expect(draft.layout.openings[3].glass_type).toBe("frosted");
  await expect
    .poll(() => previews.some((p) => p.layout.openings.length === 4), {
      timeout: 30000,
    })
    .toBe(true);
  await page.locator(".edit-tool-tabs").getByRole("button", { name: "灯具", exact: true }).click();
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("button", { name: "从灯具素材库选择", exact: true }).click();
  await expect(page.getByLabel("灯具素材列表").getByRole("button")).toHaveCount(
    6,
  );
  await page.getByRole("button", { name: "在平面中放置", exact: true }).click();
  const lightBar = page.getByRole("region", { name: "灯具放置", exact: true });
  await expect(lightBar).toBeVisible();
  const lightPoint = await planPoint(2, 2.4);
  await page.mouse.move(lightPoint.x, lightPoint.y);
  await expect(lightBar).toHaveAttribute("data-valid", "true");
  await page.mouse.click(lightPoint.x, lightPoint.y);
  await expect.poll(() => draft?.layout?.lights.length).toBe(1);
  expect(draft.layout.lights[0].kind).toBe("floor_lamp");
  await page.getByLabel("灯具亮度", { exact: true }).fill("520");
  await page.getByLabel("灯具亮度", { exact: true }).press("Enter");
  await expect.poll(() => draft?.layout?.lights[0]?.lumens).toBe(520);
  await page
    .getByRole("button", { name: "浏览灯具素材库", exact: true })
    .click();
  await page
    .getByLabel("灯具素材列表")
    .getByRole("button", { name: /陶瓷床头台灯/ })
    .click();
  await page.getByRole("button", { name: "在三维中放置", exact: true }).click();
  await expect(scene).toBeVisible();
  await placeScene(lightBar);
  await expect.poll(() => draft?.layout?.lights.length).toBe(2);
  expect(draft.layout.lights[1].kind).toBe("table_lamp");
  await expect(page.locator(".scene-sync")).toHaveText("已同步", {
    timeout: 60000,
  });
  checks.push(
    "灯具素材库六款模型可浏览，平面放置落地灯并调整亮度、三维放置台灯、真实模型同步通过",
  );
  await page
    .getByRole("button", { name: "保存并生成三维", exact: true })
    .click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].layout.lights).toHaveLength(2);
  expect(saves[0].layout.walls).toHaveLength(6);
  expect(saves[0].layout.openings).toHaveLength(4);
  await page.reload();
  await expect(scene).toBeVisible();
  await expect(page.locator(".scene-sync")).toHaveText("已同步", {
    timeout: 60000,
  });
  await expect.poll(() => draft?.layout.walls.length).toBe(6);
  await page.screenshot({ path: path.join(output, "scene-placement.png") });
  checks.push(
    "三维画布新增栏板、墙面安装磨砂窗、真实 GLB 预览、保存请求及刷新后的草稿恢复通过",
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
} catch (error) {
  if (page) {
    await page.screenshot({
      path: path.join(output, "failure.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(output, "failure.txt"),
      await page.locator("body").innerText(),
    );
  }
  throw error;
} finally {
  await browser.close();
}
