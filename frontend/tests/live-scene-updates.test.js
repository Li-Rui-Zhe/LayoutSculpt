import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  canSyncLiveScene,
  mayReuseSavedScene,
} from "../src/editor/liveSceneUpdates.js";
import { previewKey } from "../src/editor/previewIdentity.js";
import {
  installFixtureLights,
  syncFixtureParameters,
  updateFixtureLights,
} from "../src/viewer/fixtureLights.js";
import { updateLiveArchitecture } from "../src/editor/liveArchitecture.js";
import { createPreviewQueue } from "../src/editor/previewQueue.js";

const fixture = () => ({
  layout: {
    title: "家",
    walls: [],
    rooms: [],
    openings: [],
    outline: [],
    lights: [
      {
        id: "lamp",
        x: 1,
        y: 1,
        elevation: 2,
        kind: "bulb",
        lumens: 500,
        temperature: 3000,
        enabled: true,
      },
    ],
  },
  furniture: {
    items: [
      {
        edit_id: "sofa",
        kind: "sofa",
        room_id: "r1",
        x: 1,
        y: 1,
        rotation: 0,
        elevation: 0,
        width: 2,
        depth: 1,
        height: 1,
      },
    ],
    notes: [],
  },
});
const capabilities = { furnitureKeys: ["sofa"], lightIds: ["lamp"] };

test("家具位姿与灯光参数组合修改可即时显示，未绑定对象和几何变化必须建模", () => {
  const base = fixture(),
    next = structuredClone(base);
  Object.assign(next.furniture.items[0], {
    x: 3,
    rotation: 90,
    elevation: 1,
    room_id: "r2",
    edit_hidden: true,
  });
  Object.assign(next.layout.lights[0], {
    lumens: 800,
    temperature: 6500,
    enabled: false,
  });
  assert.equal(canSyncLiveScene(base, next, capabilities), true);
  assert.equal(canSyncLiveScene(base, next, {}), false);
  assert.equal(mayReuseSavedScene(base, next), true);
  for (const mutate of [
    (d) => d.furniture.items[0].width++,
    (d) => (d.furniture.items[0].kind = "bed"),
    (d) => (d.furniture.items[0].asset_id = "new"),
    (d) => d.layout.lights[0].x++,
    (d) => (d.layout.lights[0].kind = "table_lamp"),
    (d) => d.furniture.items.push({ ...d.furniture.items[0], edit_id: "new" }),
  ]) {
    const doc = structuredClone(next);
    mutate(doc);
    assert.equal(canSyncLiveScene(base, doc, capabilities), false);
  }
});

test("改名称、锁定和说明不触发模型请求或临时建筑覆盖", () => {
  const base = fixture(),
    next = structuredClone(base);
  next.layout.title = "改名";
  next.layout.lights[0].name = "新灯名";
  next.layout.lights[0].edit_locked = true;
  next.furniture.notes = ["备注"];
  assert.equal(previewKey(base), previewKey(next));
  const group = new THREE.Group(),
    model = new THREE.Group();
  group.add(model);
  const rt = { group, modelDocument: base };
  updateLiveArchitecture(rt, next, true, false);
  assert.equal(rt.architectureOverlay, undefined);
});

test("两盏共用材质的灯仍独立开关、调色温，白天不发光", () => {
  const model = new THREE.Group(),
    material = new THREE.MeshStandardMaterial({ emissive: "white" });
  for (const id of ["a", "b"]) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.05), material);
    mesh.userData = {
      fixture_id: id,
      fixture_lumens: 500,
      fixture_temperature: 3000,
      fixture_enabled: true,
    };
    model.add(mesh);
  }
  installFixtureLights(model);
  const [a, b] = model.userData.designLights;
  assert.notEqual(a.materials[0], b.materials[0]);
  syncFixtureParameters(model, [
    { id: "a", lumens: 900, temperature: 6500, enabled: false },
    { id: "b", lumens: 400, temperature: 2700, enabled: true },
  ]);
  updateFixtureLights(model, true);
  assert.equal(a.light.intensity, 0);
  assert.ok(b.light.intensity > 0);
  assert.equal(a.materials[0].emissiveIntensity, 0);
  assert.ok(b.materials[0].emissiveIntensity > 0);
  assert.notEqual(a.light.color.getHex(), b.light.color.getHex());
  updateFixtureLights(model, false);
  assert.equal(b.light.intensity, 0);
});

test("重复提交进行中的同一预览不会取消或重建；失败后允许再次提交", async () => {
  const pending = [],
    reports = [],
    published = [];
  const queue = createPreviewQueue({
    delay: 0,
    report: (v) => reports.push(v),
    publish: (v) => published.push(v),
    build: (_d, signal) =>
      new Promise((resolve, reject) =>
        pending.push({ resolve, reject, signal }),
      ),
  });
  const tick = () => new Promise((r) => setTimeout(r, 15));
  queue.submit({ value: 1 });
  await tick();
  queue.submit({ value: 1 });
  await tick();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].signal.aborted, false);
  pending[0].reject(Error("暂时失败"));
  await tick();
  queue.submit({ value: 1 });
  await tick();
  assert.equal(pending.length, 2);
  queue.submit({ value: 2 });
  await tick();
  pending[1].resolve("过期结果");
  pending[2].resolve("最新结果");
  await tick();
  assert.deepEqual(
    published.map((v) => v.result),
    ["最新结果"],
  );
  queue.close();
  queue.submit({ value: 3 });
  await tick();
  assert.equal(pending.length, 3);
});
