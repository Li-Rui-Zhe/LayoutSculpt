import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { applySceneEdit, scenePose } from "../src/editor/sceneEdits.js";
import {
  bindLiveFurniture,
  syncLiveFurniture,
  selectionFromHit,
} from "../src/editor/liveModel.js";
import { updateLiveArchitecture } from "../src/editor/liveArchitecture.js";
import { createPreviewQueue } from "../src/editor/previewQueue.js";
import { identifyObjects, lockedChange } from "../src/editor/objectIdentity.js";

const doc = () =>
  identifyObjects(
    {
      layout: {
        outline: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 6, y: 6 },
          { x: 0, y: 6 },
        ],
        rooms: [
          {
            id: "r",
            name: "客厅",
            polygon: [
              { x: 0, y: 0 },
              { x: 6, y: 0 },
              { x: 6, y: 6 },
              { x: 0, y: 6 },
            ],
          },
        ],
        walls: [
          {
            id: "w",
            start: { x: 0, y: 0 },
            end: { x: 6, y: 0 },
            height: 2.8,
            thickness: 0.2,
            exterior: true,
          },
          {
            id: "w2",
            start: { x: 6, y: 0 },
            end: { x: 6, y: 6 },
            height: 2.8,
            thickness: 0.2,
            exterior: true,
          },
        ],
        openings: [
          {
            wall_id: "w",
            kind: "window",
            offset: 1,
            width: 1,
            height: 1,
            bottom: 1,
          },
        ],
        lights: [
          {
            id: "l",
            x: 3,
            y: 3,
            elevation: 2,
            temperature: 3000,
            lumens: 800,
            enabled: true,
          },
        ],
      },
      furniture: {
        items: [
          {
            kind: "sofa",
            room_id: "r",
            x: 2,
            y: 3,
            width: 2,
            depth: 1,
            height: 0.8,
            rotation: 0,
            elevation: 0,
          },
        ],
        notes: [],
      },
    },
    true,
  );
const change = (d, type, index = 0, values = {}) =>
  applySceneEdit(
    d,
    { type, index },
    {
      ...scenePose(d, { type, index }),
      scale: { x: 1, y: 1, z: 1 },
      ...values,
    },
  );

test("三维家具变换使用米制坐标、角度与局部尺寸，不修改输入快照", () => {
  const d = doc(),
    next = change(d, "furniture", 0, {
      x: 3,
      y: 4,
      rotation: 450,
      elevation: 1.035,
      scale: { x: 1.5, y: 2, z: 0.5 },
    });
  const f = next.furniture.items[0];
  assert.deepEqual(
    [f.x, f.y, f.rotation, f.elevation, f.width, f.depth, f.height],
    [3, 4, 90, 1, 3, 0.5, 1.6],
  );
  assert.equal(d.furniture.items[0].x, 2);
});
test("墙体移动带动共享端点和房间边界，门窗保留墙上相对位置", () => {
  const d = doc(),
    n = change(d, "walls", 0, { y: 0.5 });
  assert.equal(n.layout.walls[1].start.y, 0.5);
  assert.equal(n.layout.rooms[0].polygon[0].y, 0.5);
  assert.equal(n.layout.openings[0].offset, 1);
  assert.equal(scenePose(n, { type: "openings", index: 0 }).y, 0.5);
});
test("墙体缩放同步开口宽度与位置", () => {
  const n = change(doc(), "walls", 0, { scale: { x: 0.8, y: 1, z: 1 } });
  assert.equal(n.layout.openings[0].width, 0.8);
  assert.equal(n.layout.openings[0].offset, 0.8);
});
test("门窗沿所属墙投影、窗台可升降，门与通道始终落地", () => {
  const d = doc();
  const n = change(d, "openings", 0, { x: 20, y: 9, elevation: 1.2 });
  assert.equal(n.layout.openings[0].offset, 5);
  assert.equal(n.layout.openings[0].bottom, 1.2);
  for (const kind of ["door", "passage"]) {
    d.layout.openings[0].kind = kind;
    assert.equal(
      change(d, "openings", 0, { elevation: 2 }).layout.openings[0].bottom,
      0,
    );
  }
});
test("地板平面修改和灯具三轴位置可同步", () => {
  const d = doc();
  assert.equal(
    change(d, "rooms", 0, { x: 3.2 }).layout.rooms[0].polygon[0].x,
    0.2,
  );
  assert.equal(
    change(d, "lights", 0, { elevation: 2.6 }).layout.lights[0].elevation,
    2.6,
  );
});
test("拒绝零尺寸、反转、非有限数；关联锁定对象不能被间接改动", () => {
  const d = doc();
  for (const x of [0, -1, NaN])
    assert.throws(() =>
      change(d, "furniture", 0, { scale: { x, y: 1, z: 1 } }),
    );
  d.furniture.items[0].edit_locked = true;
  assert.equal(change(d, "furniture", 0, { x: 5 }), d);
  d.layout.walls[1].edit_locked = true;
  assert.ok(lockedChange(d, change(d, "walls", 0, { y: 0.5 })));
});
test("旧模型点击使用稳定标识：删除后不会误选下一个家具", () => {
  const d = doc(),
    n = structuredClone(d);
  n.furniture.items = [{ ...n.furniture.items[0], edit_id: "different" }];
  assert.equal(selectionFromHit({ furniture_index: 0 }, d, n), null);
  n.furniture.items.unshift({ ...d.furniture.items[0] });
  assert.deepEqual(selectionFromHit({ furniture_index: 0 }, d, n), {
    type: "furniture",
    index: 0,
  });
});
test("家具枢轴保留原世界坐标，平移缩放和删除即时更新所有部件", () => {
  const d = doc(),
    model = new THREE.Group(),
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
  model.position.set(4, 0, 2);
  mesh.position.set(-1, 0.5, 0);
  mesh.userData.furniture_index = 0;
  model.add(mesh);
  model.updateMatrixWorld(true);
  const before = mesh.matrixWorld.clone(),
    groups = bindLiveFurniture(model, d);
  model.updateMatrixWorld(true);
  assert.ok(before.equals(mesh.matrixWorld));
  const n = change(d, "furniture", 0, { x: 3, scale: { x: 2, y: 1, z: 1 } });
  syncLiveFurniture(groups, n);
  const pivot = [...groups.values()][0];
  assert.equal(pivot.position.x, 0);
  assert.equal(pivot.scale.x, 2);
  n.furniture.items = [];
  syncLiveFurniture(groups, n);
  assert.equal(pivot.visible, false);
});
test("实时结构网格保留门窗洞口，取消后恢复原模型", () => {
  const d = doc(),
    model = new THREE.Group(),
    old = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
    );
  old.userData.wall_id = "w";
  model.add(old);
  const group = new THREE.Group();
  group.add(model);
  const rt = { group, modelDocument: d };
  updateLiveArchitecture(rt, change(d, "walls", 0, { y: 0.2 }), false, false);
  assert.equal(old.visible, false);
  const walls = rt.architectureOverlay.children.filter(
    (o) => o.userData.wall_id === "w" && o.userData.opening_index == null,
  );
  assert.equal(walls.length, 4); // 开口两边及上下四块
  updateLiveArchitecture(rt, d, false, false);
  assert.equal(old.visible, true);
  assert.equal(rt.architectureOverlay, null);
});
const tick = () => new Promise((r) => setTimeout(r, 5));
test("较慢旧请求不会覆盖新结果，关闭后不会再发布", async () => {
  const pending = [],
    published = [];
  const queue = createPreviewQueue({
    delay: 0,
    report: () => {},
    build: (d, signal) =>
      new Promise((resolve) => pending.push({ d, resolve, signal })),
    publish: (v) => published.push(v),
  });
  queue.submit("old");
  await tick();
  queue.submit("new");
  await tick();
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve("new-glb");
  await tick();
  pending[0].resolve("old-glb");
  await tick();
  assert.deepEqual(
    published.map((v) => v.result),
    ["new-glb"],
  );
  queue.submit("closed");
  await tick();
  queue.close();
  pending[2].resolve("closed-glb");
  await tick();
  assert.equal(published.length, 1);
});
test("构建错误可重试并继续发布新模型", async () => {
  const states = [],
    published = [];
  let failed = true;
  const q = createPreviewQueue({
    delay: 0,
    report: (s) => states.push(s),
    build: async () => {
      if (failed) throw Error("失败");
      return "ok";
    },
    publish: (v) => published.push(v),
  });
  q.submit({});
  await tick();
  assert.equal(states.at(-1).phase, "error");
  failed = false;
  q.submit({});
  await tick();
  assert.equal(published[0].result, "ok");
  q.close();
});

// 直接抓取不同表面、首拖未选对象及取消操作，不能改变镜头或生成重复历史。
import {
  createDirectDrag,
  installDirectDrag,
} from "../src/editor/directSceneDrag.js";

test("直接抓家具保留抓取偏移和离地高度，不跳到鼠标中心", () => {
  const document = doc(),
    selection = { type: "furniture", index: 0 };
  const pose = scenePose(document, selection);
  const drag = createDirectDrag(
    document,
    selection,
    new THREE.Vector3(3, 0.8, 2),
  );
  const t = drag.transform(
    new THREE.Ray(new THREE.Vector3(3.5, 5, 1.75), new THREE.Vector3(0, -1, 0)),
  );
  assert.equal(t.x, pose.x + 0.5);
  assert.equal(t.y, pose.y - 0.25);
  assert.equal(t.elevation, pose.elevation);
  document.furniture.items[0].edit_locked = true;
  assert.equal(
    createDirectDrag(document, selection, new THREE.Vector3()),
    null,
  );
});

test("直接拖窗沿墙升降且不超墙高；俯视拖窗仍可水平移动", () => {
  const document = doc(),
    selection = { type: "openings", index: 0 };
  const point = new THREE.Vector3(1.5, 1.5, 0);
  const drag = createDirectDrag(document, selection, point);
  const t = drag.transform(
    new THREE.Ray(new THREE.Vector3(2, 5, 5), new THREE.Vector3(0, 0, -1)),
  );
  assert.equal(t.x, 2);
  assert.ok(Math.abs(t.elevation - 1.8) < 1e-9);
  const ray = new THREE.Ray(
    new THREE.Vector3(2, 5, 0),
    new THREE.Vector3(0, -1, 0),
  );
  const top = createDirectDrag(document, selection, point, ray).transform(ray);
  assert.equal(top.x, 2);
  assert.equal(top.elevation, 1);
});

test("首拖使用命中对象；点击不提交，单次拖动仅提交一次，取消不提交", () => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const element = new EventTarget();
  let captured = false;
  element.style = {};
  element.setPointerCapture = () => (captured = true);
  element.hasPointerCapture = () => captured;
  element.releasePointerCapture = () => (captured = false);
  const document = doc(),
    events = [];
  const callbacks = {
    current: {
      liveDocument: document,
      liveSelection: { type: "walls", index: 0 },
      liveEditable: true,
      transformMode: "direct",
      onObjectSelect: () => {},
      onSceneGesture: (...args) => events.push(args),
    },
  };
  const rt = { modelDocument: document, controls: { enabled: true } };
  const cleanup = installDirectDrag({
    element,
    rt,
    callbacks,
    pick: () => ({
      data: { furniture_index: 0 },
      point: new THREE.Vector3(2, 0.8, 2),
    }),
    rayAt: (e) =>
      new THREE.Ray(
        new THREE.Vector3(2 + e.clientX / 100, 5, 2),
        new THREE.Vector3(0, -1, 0),
      ),
  });
  const send = (type, x = 0, extra = {}) => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, {
      pointerId: 1,
      clientX: x,
      clientY: 0,
      button: 0,
      ...extra,
    });
    element.dispatchEvent(e);
  };
  try {
    send("pointerdown");
    send("pointerup");
    assert.equal(events.length, 0);
    send("pointerdown");
    send("pointermove", 30);
    send("pointermove", 40);
    send("pointerup", 40);
    assert.deepEqual(events[0][2], { type: "furniture", index: 0 });
    assert.deepEqual(
      events.map((e) => e[0]),
      ["start", "preview", "preview", "end"],
    );
    assert.equal(rt.controls.enabled, true);
    events.length = 0;
    send("pointerdown");
    send("pointermove", 20);
    send("pointercancel");
    assert.equal(events.at(-1)[0], "cancel");
    assert.equal(events.filter((e) => e[0] === "end").length, 0);
    assert.equal(captured, false);
    events.length = 0;
    send("pointerdown", 0, { shiftKey: true });
    send("pointermove", 20);
    send("pointerup");
    assert.equal(events.length, 0);
  } finally {
    cleanup();
    globalThis.window = previousWindow;
  }
});
