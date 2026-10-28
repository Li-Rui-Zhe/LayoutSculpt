// 真 GLB + 隔离任务：门扇即时变换、导出几何一致性及零预览请求。
import { expect } from "@playwright/test";
import { launchReviewBrowser } from "./browser.mjs";
import { findPython } from "../python.mjs";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const base = process.env.STUDIO_BASE_URL || "http://127.0.0.1:5176";
const output = path.resolve("data/visual-review/live-doors");
await mkdir(output, { recursive: true });
execFileSync(findPython(process.cwd()), [
  "-X",
  "utf8",
  "-c",
  `
import json,sys
from pathlib import Path
from backend.tests.test_workflow import layout_data,furniture_data
from backend.app.schemas import Layout
from backend.app.glb_builder import Builder
from backend.app.config import Settings
d=layout_data()
d['openings']=[dict(d['openings'][0],wall_id='w0',angle=90),dict(d['openings'][0],wall_id='w1',width=1.6,door_style='double',angle=60),dict(d['openings'][0],wall_id='w2',door_material='glass',angle=45)]
d['lights']=[dict(id='lamp',name='测试台灯',kind='table_lamp',x=5,y=4,elevation=1.1,lumens=400,temperature=3000,enabled=True)]
d={**Layout.model_validate(d).model_dump(),'furniture':furniture_data()['items'],'style':'natural'}
p=Path(sys.argv[1]);(p/'fixture.json').write_text(json.dumps(d),encoding='utf-8')
Builder(d,Settings().furniture_catalog).build(p/'original')
for o in d['openings']: o.update(angle=37,hinge='end',swing='right')
d['furniture'][0].update(x=3.1,y=3,rotation=37,elevation=.2)
d['lights'][0].update(x=4.5,y=3.5)
Builder(d,Settings().furniture_catalog).build(p/'closed')
`,
  output,
]);
const fixture = JSON.parse(
  await readFile(path.join(output, "fixture.json"), "utf8"),
);
const model = await readFile(path.join(output, "original/model.glb"));
const closed = await readFile(path.join(output, "closed/model.glb"));
const id = "dddd0000000000000000000000000001";
const job = {
  id,
  name: "门扇即时开合验收",
  status: "succeeded",
  progress: 100,
  options: { style: "natural" },
  created_at: "2026-10-28T12:00:00Z",
  updated_at: "2026-10-28T12:00:00Z",
  result: {
    revision: "doors-1",
    model_url: `/api/jobs/${id}/model.glb`,
    layout_url: `/api/jobs/${id}/artifacts/layout.json`,
  },
};
const browser = await launchReviewBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [],
  previews = [],
  saves = [],
  writes = [];
let draft = null,
  revision = 0;
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      p = new URL(req.url()).pathname;
    const json = (value) => route.fulfill({ json: value });
    if (p === "/api/jobs/page")
      return json({ items: [job], before: null, cursor: "fixture" });
    if (p === "/api/jobs/changes")
      return json({ items: [], cursor: "fixture", more: false });
    if (p === `/api/jobs/${id}`) return json(job);
    if (p === `/api/jobs/${id}/edit` && req.method() === "POST") {
      saves.push(req.postDataJSON());
      return json(job);
    }
    if (p.endsWith("/timeline")) return json({ items: [] });
    if (p.endsWith("/events"))
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": fixture\n\n",
      });
    if (p === `/api/jobs/${id}/artifacts/layout.json`) return json(fixture);
    if (p.endsWith("/model.glb"))
      return route.fulfill({
        contentType: "model/gltf-binary",
        body: p.includes("closed") ? closed : model,
      });
    if (p.startsWith("/api/drafts/")) {
      if (decodeURIComponent(p) !== `/api/drafts/edit:${id}`)
        return json({ document: null, revision: 0 });
      if (req.method() === "POST") {
        draft = req.postDataJSON().document;
        revision++;
      }
      return json({ document: draft, revision });
    }
    if (p === "/api/design/check") return json({ valid: true, issues: [] });
    if (p.endsWith("/preview")) {
      previews.push(req.postDataJSON());
      return route.fulfill({
        status: 500,
        json: { detail: "仅改开合不应请求建模" },
      });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method())) {
      writes.push(p);
      return route.fulfill({ status: 500 });
    }
    return route.continue();
  });
  await page.goto(`${base}/?project=${id}&tab=edit&editorView=scene#workspace`);
  await expect(page.locator(".scene-sync")).toHaveText("已同步", {
    timeout: 60000,
  });
  // 在浏览器中比较实际 GLB 网格：本地变换结果应与后端正式导出一致。
  const comparison = await page.evaluate(
    async ({ id, fixture, root }) => {
      const THREE = await import(
        `/@fs/${root}/node_modules/three/build/three.module.js`
      );
      const { GLTFLoader } = await import(
        `/@fs/${root}/node_modules/three/examples/jsm/loaders/GLTFLoader.js`
      );
      const { bindLiveDoors, syncLiveDoors, canSyncDoorPoses } =
        await import("/src/editor/liveDoors.js");
      const { toDraft } = await import("/src/editor/geometry.js");
      const { bindLiveFurniture, syncLiveFurniture } =
        await import("/src/editor/liveModel.js");
      const { canSyncLiveScene } =
        await import("/src/editor/liveSceneUpdates.js");
      const { bindLiveLights, syncLiveLights } = await import("/src/editor/liveLights.js");
      const loader = new GLTFLoader();
      const original = (await loader.loadAsync(`/api/jobs/${id}/model.glb`))
        .scene;
      const expected = (await loader.loadAsync(`/api/closed/model.glb`)).scene;
      const doc = toDraft(fixture),
        next = structuredClone(doc);
      for (const o of next.layout.openings)
        Object.assign(o, { angle: 37, hinge: "end", swing: "right" });
      Object.assign(next.furniture.items[0], {
        x: 3.1,
        y: 3,
        rotation: 37,
        elevation: 0.2,
      });
      Object.assign(next.layout.lights[0], { x: 4.5, y: 3.5 });
      original.position.set(1.3, 0, -2.6);
      expected.position.copy(original.position);
      original.updateMatrixWorld(true);
      const originalBoxes = new Map();
      original.traverse((o) => {
        if (o.isMesh)
          originalBoxes.set(o.name, new THREE.Box3().setFromObject(o));
      });
      const bindings = bindLiveDoors(original, doc);
      const furniture = bindLiveFurniture(original, doc);
      const lamps = bindLiveLights(original, doc);
      syncLiveLights(lamps, next);
      syncLiveDoors(bindings, doc, next);
      syncLiveFurniture(furniture, next);
      let maxError = 0;
      const expectedNodes = new Map();
      expected.updateMatrixWorld(true);
      expected.traverse((o) => {
        if (o.isMesh) expectedNodes.set(o.name, o);
      });
      original.traverse((o) => {
        if (
          !o.isMesh ||
          (o.userData.opening_index == null &&
            o.userData.furniture_index == null && !o.userData.fixture_owner_id)
        )
          return;
        const target = expectedNodes.get(o.name);
        if (!target) throw Error(`导出网格缺失：${o.name}`);
        // 每个对应网格包围盒与正式导出一致，包含门框、玻璃、把手及剖切上下半段。
        const a = new THREE.Box3().setFromObject(o),
          b = new THREE.Box3().setFromObject(target);
        maxError = Math.max(
          maxError,
          a.min.distanceTo(b.min),
          a.max.distanceTo(b.max),
        );
      });
      syncLiveDoors(bindings, doc, doc);
      syncLiveFurniture(furniture, doc);
      syncLiveLights(lamps, doc);
      let undoError = 0;
      original.traverse((o) => {
        if (!o.isMesh) return;
        const box = new THREE.Box3().setFromObject(o),
          old = originalBoxes.get(o.name);
        undoError = Math.max(
          undoError,
          box.min.distanceTo(old.min),
          box.max.distanceTo(old.max),
        );
      });
      const resized = structuredClone(next);
      resized.layout.openings[0].width += 0.1;
      return {
        bound: bindings.size,
        maxError,
        undoError,
        local: canSyncLiveScene(doc, next, {
          doorIndices: [...bindings.keys()],
          furnitureKeys: [...furniture.keys()],
          lightPoseIds: [...lamps.keys()],
        }),
        resizedLocal: canSyncDoorPoses(doc, resized, [...bindings.keys()]),
      };
    },
    { id, fixture, root: process.cwd().replaceAll("\\", "/") },
  );
  expect(comparison.bound).toBe(3);
  expect(comparison.maxError).toBeLessThan(0.0001);
  expect(comparison.undoError).toBeLessThan(0.0001);
  expect(comparison.local).toBe(true);
  expect(comparison.resizedLocal).toBe(false);
  await page
    .locator(".edit-tool-tabs")
    .getByRole("button", { name: "门窗", exact: true })
    .click();
  for (let i = 0; i < 3; i++) {
    await page.getByLabel("设计对象列表").getByRole("button").nth(i).click();
    const detail = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: "门扇与开启方式" }) });
    if (!(await detail.getAttribute("open")))
      await detail.locator("summary").click();
    for (const angle of ["0", "45", "90", "15"]) {
      await page.getByLabel("开启角度", { exact: true }).fill(angle);
      await page.getByLabel("开启角度", { exact: true }).press("Enter");
      await expect
        .poll(() => draft?.layout?.openings[i].angle)
        .toBe(Number(angle));
      await expect(page.locator(".scene-sync")).toHaveText("已同步");
      await expect(
        page.locator('.scene-object-label[data-state="loading"]'),
      ).toHaveCount(0);
    }
  }
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect.poll(() => draft?.layout.openings[2].angle).toBe(90);
  await page
    .locator(".edit-tool-tabs")
    .getByRole("button", { name: "家具", exact: true })
    .click();
  await page.getByText("位置与离地高度", { exact: true }).click();
  await page.getByLabel("左右位置", { exact: true }).fill("3.1");
  await page.getByLabel("左右位置", { exact: true }).press("Enter");
  await expect.poll(() => draft?.furniture.items[0].x).toBe(3.1);
  await expect(page.locator(".scene-sync")).toHaveText("已同步");
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect.poll(() => draft?.furniture.items[0].x).toBe(2);
  await page
    .locator(".edit-tool-tabs")
    .getByRole("button", { name: "灯具", exact: true })
    .click();
  const start = await page.evaluate(async (root) => {
    const THREE = await import(`/@fs/${root}/node_modules/three/build/three.module.js`);
    // 仅验收脚本读取 React 中的镜头引用，用真实指针命中模型，无生产调试接口。
    const host = document.querySelector('.diy-preview-wrap');
    let fiber = host[Object.keys(host).find((key) => key.startsWith('__reactFiber'))], rt;
    while (fiber && !rt) {
      let hook = fiber.memoizedState;
      while (hook) {
        const value = hook.memoizedState?.current;
        if (value?.renderer && value?.camera && value?.group) { rt = value; break; }
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    if (!rt) throw Error('未找到三维编辑器镜头');
    const { scene, camera } = rt, canvas = rt.renderer.domElement;
    let mesh;
    scene.traverse((node) => { if (node.userData.fixture_id === "lamp" && node.isMesh && !node.userData.editor_proxy) mesh = node; });
    const point = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()).project(camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x + (point.x + 1) * rect.width / 2, y: rect.y + (1 - point.y) * rect.height / 2 };
  }, process.cwd().replaceAll("\\", "/"));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(start.x + i * 5, start.y + i * 2, { steps: 3 });
    await expect(page.locator('.scene-object-label[data-state="loading"]')).toHaveCount(0);
  }
  await page.mouse.up();
  await expect.poll(() => draft?.layout.lights[0].x).not.toBe(5);
  await expect(page.locator(".scene-sync")).toHaveText("已同步");
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect.poll(() => draft?.layout.lights[0].x).toBe(5);
  await page.locator(".edit-tool-tabs").getByRole("button", { name: "灯具", exact: true }).click();
  await page.getByLabel("灯具亮度", { exact: true }).fill("820");
  await page.getByLabel("灯具亮度", { exact: true }).press("Enter");
  await page.getByLabel("灯光色温").selectOption("6500");
  await page.getByLabel("灯具开关").selectOption("off");
  await expect.poll(() => draft?.layout.lights[0].enabled).toBe(false);
  await expect(page.locator(".scene-sync")).toHaveText("已同步");
  await expect(
    page.locator('.scene-object-label[data-state="loading"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "平面设计", exact: true }).click();
  await page.getByRole("button", { name: "三维设计", exact: true }).click();
  await expect(page.locator(".scene-sync")).toHaveText("已同步");
  // 浏览器刷新恢复草稿后，先载入已有模型，再本地同步这些参数。
  await page.reload();
  await expect(page.locator(".scene-sync")).toHaveText("已同步", {
    timeout: 60000,
  });
  expect(previews).toHaveLength(0);
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
  await page.screenshot({ path: path.join(output, "doors.png") });
  await page
    .getByRole("button", { name: "保存并生成三维", exact: true })
    .click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].layout.lights[0].lumens).toBe(820);
  expect(saves[0].layout.lights[0].temperature).toBe(6500);
  expect(saves[0].layout.lights[0].enabled).toBe(false);
  expect(saves[0].layout.openings[2].angle).toBe(90);
  console.log(
    JSON.stringify({
      comparison,
      previewRequests: previews.length,
      result: "门扇、家具、灯具即时变换与导出一致；灯具实际鼠标拖动无加载提示，撤销与保存通过",
    }),
  );
} catch (e) {
  await page.screenshot({
    path: path.join(output, "failure.png"),
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
}
