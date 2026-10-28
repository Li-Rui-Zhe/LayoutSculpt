// 只读载入实际生成成果及草稿，在隔离任务里验收；全部写请求拦截。
// node scripts/review/verify_generated_drag.mjs <本地项目 ID>
import { expect } from "@playwright/test";
import { launchReviewBrowser } from "./browser.mjs";
import { findPython } from "../python.mjs";
import { execFileSync } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { toDraft } from "../../frontend/src/editor/geometry.js";
import { identifyObjects } from "../../frontend/src/editor/objectIdentity.js";

const sourceId = process.argv[2];
if (!/^[a-f0-9]{32}$/.test(sourceId || "")) throw Error("请指定本地项目 ID");
const base = process.env.STUDIO_BASE_URL || "http://127.0.0.1:5176";
const source = path.resolve("data/jobs", sourceId);
const fixture = JSON.parse(await readFile(path.join(source, "layout.json"), "utf8"));
const model = await readFile(path.join(source, "model.glb"));
let draft = JSON.parse(execFileSync(findPython(process.cwd()), ["-X", "utf8", "-c", `
import sqlite3,sys
c=sqlite3.connect('file:data/studio.sqlite3?mode=ro',uri=True)
r=c.execute('select document from workspace_drafts where key=?',('edit:'+sys.argv[1],)).fetchone()
print(r[0] if r else 'null')
`, sourceId], { encoding: "utf8" }));
// 只回放待测灯具的已有修改。用户新增门洞等结构修改本就需要建模，
// 不混入“灯具平移零建模”的断言；原项目与原草稿始终只读。
const savedLights = draft?.layout?.lights;
draft = identifyObjects(toDraft(fixture), true);
if (savedLights && savedLights.length === draft.layout.lights.length)
  draft.layout.lights = savedLights;
let revision = 1;
const id = "dddd0000000000000000000000000002";
const job = { id, name: "生成户型拖动回归", status: "succeeded", progress: 100,
  options: { style: "natural" }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  result: { revision: "drag-1", model_url: `/api/jobs/${id}/model.glb`, layout_url: `/api/jobs/${id}/artifacts/layout.json` } };
const output = path.resolve("data/visual-review/generated-drag");
await mkdir(output, { recursive: true });
const browser = await launchReviewBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [], previews = [], writes = [], saves = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.route("**/api/**", async (route) => {
    const req = route.request(), p = new URL(req.url()).pathname;
    const json = (value) => route.fulfill({ json: value });
    if (p === "/api/client-access") return json({ application: "layoutsculpt", protocol: 1, origin: new URL(req.url()).searchParams.get("origin"), write_allowed: true });
    if (p === "/api/jobs/page") return json({ items: [job], cursor: "fixture", before: null });
    if (p === "/api/jobs/changes") return json({ items: [], cursor: "fixture", more: false });
    if (p === `/api/jobs/${id}`) return json(job);
    if (p.endsWith("/timeline")) return json({ items: [] });
    if (p.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: ": fixture\n\n" });
    if (p === `/api/jobs/${id}/artifacts/layout.json`) return json(fixture);
    if (p === `/api/jobs/${id}/model.glb`) return route.fulfill({ contentType: "model/gltf-binary", body: model });
    if (p.startsWith("/api/drafts/")) {
      if (decodeURIComponent(p) !== `/api/drafts/edit:${id}`) return json({ document: null, revision: 0 });
      if (req.method() === "POST") { draft = req.postDataJSON().document; revision++; }
      return json({ document: draft, revision, updated_at: new Date().toISOString() });
    }
    if (p === "/api/design/check") return json({ valid: true, issues: [] });
    if (p.endsWith("/preview")) { previews.push(p); return route.fulfill({ status: 500, json: { detail: "平移不应建模" } }); }
    if (p === `/api/jobs/${id}/edit`) { saves.push(req.postDataJSON()); return json(job); }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method())) { writes.push(p); return route.fulfill({ status: 500 }); }
    return route.continue();
  });
  await page.goto(`${base}/?project=${id}&tab=edit&editorView=scene#workspace`);
  await expect(page.locator(".scene-sync")).toHaveText("已同步", { timeout: 60000 });
  expect(previews).toHaveLength(0);
  await page.locator(".edit-tool-tabs").getByRole("button", { name: "灯具", exact: true }).click();
  await page.evaluate(() => {
    const host = document.querySelector(".diy-preview-wrap");
    let fiber = host[Object.keys(host).find((key) => key.startsWith("__reactFiber"))], rt;
    while (fiber && !rt) {
      let hook = fiber.memoizedState;
      while (hook) {
        const value = hook.memoizedState?.current;
        if (value?.renderer && value?.camera && value?.group) { rt = value; break; }
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    if (!rt) throw Error("未找到三维编辑器");
    window.__dragReview = { rt, overlays: 0, loadingLabels: 0, draws: 0, drawTimes: [] };
    const original = rt.renderer.render.bind(rt.renderer);
    rt.renderer.render = (...args) => {
      const state = window.__dragReview, start = performance.now();
      if (rt.architectureOverlay) state.overlays++;
      state.loadingLabels += document.querySelectorAll('.scene-object-label[data-state="loading"]').length;
      const result = original(...args);
      state.draws++;
      state.drawTimes.push(performance.now() - start);
      return result;
    };
  });
  const initial = structuredClone(draft);
  // 优先拖动仍保留生成器浮点尾差的灯，同时覆盖初始恢复已有取整的灯。
  const lightIndex = draft.layout.lights.findIndex((light) => light.y > 3 && light.elevation !== Number(light.elevation.toFixed(3)));
  if (lightIndex < 0) throw Error("验收项目需含原始高精度灯高");
  const lightId = fixture.lights[lightIndex].id;
  const drag = async (cancel = false) => {
    const start = await page.evaluate((id) => {
      const { rt } = window.__dragReview;
      let proxy;
      rt.group.traverse((node) => { if (node.userData.editor_proxy && node.userData.fixture_id === id) proxy = node; });
      if (!proxy) throw Error("缺少灯具点选区域");
      const point = proxy.getWorldPosition(rt.camera.position.clone()).project(rt.camera);
      const rect = rt.renderer.domElement.getBoundingClientRect();
      return { x: rect.x + (point.x + 1) * rect.width / 2, y: rect.y + (1 - point.y) * rect.height / 2 };
    }, lightId);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(start.x + i, start.y + i * 0.3, { steps: 2 });
      await expect(page.locator('.scene-object-label[data-state="loading"]')).toHaveCount(0);
    }
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator(".scene-sync")).toHaveText("已同步");
  };
  await drag();
  await expect.poll(() => draft.layout.lights[lightIndex].x).not.toBe(initial.layout.lights[lightIndex].x);
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect.poll(() => draft.layout.lights[lightIndex].x).toBe(initial.layout.lights[lightIndex].x);
  await drag(true);
  expect(draft.layout.lights).toEqual(initial.layout.lights);
  await drag();
  await expect.poll(() => draft.layout.lights[lightIndex].x).not.toBe(initial.layout.lights[lightIndex].x);
  const metrics = await page.evaluate(() => {
    const { overlays, loadingLabels, draws, drawTimes } = window.__dragReview;
    return { overlays, loadingLabels, draws, maxCpuDrawMs: Math.max(...drawTimes), meanCpuDrawMs: drawTimes.reduce((a, b) => a + b, 0) / draws };
  });
  expect(metrics.overlays).toBe(0); expect(metrics.loadingLabels).toBe(0);
  await page.reload();
  await expect(page.locator(".scene-sync")).toHaveText("已同步", { timeout: 60000 });
  expect(previews).toHaveLength(0); expect(errors).toEqual([]); expect(writes).toEqual([]);
  await page.screenshot({ path: path.join(output, "drag.png") });
  await page.getByRole("button", { name: "保存并生成三维", exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].layout.lights).toEqual(draft.layout.lights);
  console.log(JSON.stringify({ sourceId, metrics, previewRequests: previews.length, result: "实际生成户型及旧草稿：连续平移、取消、撤销、刷新恢复和保存通过" }));
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  throw error;
} finally { await browser.close(); }
