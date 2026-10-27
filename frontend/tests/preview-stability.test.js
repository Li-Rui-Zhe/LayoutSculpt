import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { updateLiveArchitecture } from "../src/editor/liveArchitecture.js";
import { previewProgress } from "../src/editor/previewProgress.js";
import { createPreviewQueue } from "../src/editor/previewQueue.js";

function fixture() {
  const rooms = ["bedroom", "living"].map((id, i) => ({
    id,
    name: id,
    floor_material: i ? "oak" : "walnut",
    polygon: [
      { x: i * 2, y: 0 },
      { x: i * 2 + 2, y: 0 },
      { x: i * 2 + 2, y: 2 },
      { x: i * 2, y: 2 },
    ],
  }));
  const document = {
    layout: {
      rooms,
      outline: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 2 },
        { x: 0, y: 2 },
      ],
      walls: [],
      openings: [],
      lights: [],
    },
    furniture: { items: [] },
  };
  const model = new THREE.Group();
  rooms.forEach((room, i) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshStandardMaterial({ color: i ? "#ccaa88" : "#665544" }),
    );
    mesh.userData = { structure_kind: "room", room_id: room.id };
    model.add(mesh);
  });
  const group = new THREE.Group();
  group.add(model);
  return { document, model, rt: { group, modelDocument: document } };
}

test("切换地板材质、拼缝与方向时保留旧场景，不重建全屋临时地板", () => {
  const { document, model, rt } = fixture();
  const next = structuredClone(document);
  Object.assign(next.layout.rooms[0], {
    floor_material: "marble",
    floor_rotation: 45,
    floor_pattern: "tiles",
    floor_tile_width: 0.4,
    floor_grout_color: "#6f706c",
  });
  const original = model.children.map((mesh) => mesh.material);
  updateLiveArchitecture(rt, next, true, false);
  assert.equal(rt.architectureOverlay, undefined);
  assert.equal(model.children.length, 2);
  assert.ok(
    model.children.every(
      (mesh, i) => mesh.visible && mesh.material === original[i],
    ),
  );
});

test("实际修改房间形状时，临时地板仍沿用各房间自己的材质", () => {
  const { document, model, rt } = fixture();
  const [bedroom, living] = model.children.map((mesh) => mesh.material);
  const next = structuredClone(document);
  next.layout.rooms[0].polygon[0].x += 0.2;
  updateLiveArchitecture(rt, next, false, false);
  const floors = rt.architectureOverlay.children.filter(
    (mesh) => mesh.userData.room_id,
  );
  assert.equal(
    floors.find((mesh) => mesh.userData.room_id === "bedroom").material,
    bedroom,
  );
  assert.equal(
    floors.find((mesh) => mesh.userData.room_id === "living").material,
    living,
  );
  updateLiveArchitecture(rt, document, false, false);
  assert.ok(model.children.every((mesh) => mesh.visible));
});

test("取消铺设仍立即隐藏该房间地板，不被当作纯饰面修改忽略", () => {
  const { document, rt } = fixture();
  const next = structuredClone(document);
  next.layout.rooms[0].floor_enabled = false;
  updateLiveArchitecture(rt, next, false, false);
  assert.ok(rt.architectureOverlay);
  assert.equal(
    rt.architectureOverlay.children.filter(
      (mesh) => mesh.userData.room_id === "bedroom",
    ).length,
    0,
  );
});

test("没有真实百分比的阶段不伪造预计进度，只有模型就绪才显示完成", () => {
  for (const phase of ["pending", "building", "downloading", "loading", "error"])
    assert.equal(previewProgress(phase), null);
  assert.equal(previewProgress("ready"), 100);
});

test("被新修改取代或关闭的请求不能把旧阶段写回进度条", async () => {
  const reports = [],
    pending = [];
  const queue = createPreviewQueue({
    delay: 0,
    report: (state) => reports.push(state),
    publish: () => {},
    build: (_document, _signal, report) =>
      new Promise((resolve) => pending.push({ report, resolve })),
  });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
  queue.submit("old");
  await tick();
  queue.submit("new");
  await tick();
  pending[0].report({ phase: "downloading" });
  assert.equal(reports.at(-1).phase, "building");
  pending[1].report({ phase: "downloading" });
  assert.equal(reports.at(-1).revision, 2);
  assert.equal(reports.at(-1).phase, "downloading");
  queue.close();
  const count = reports.length;
  pending[1].report({ phase: "loading" });
  assert.equal(reports.length, count);
  pending.forEach((item) => item.resolve("model"));
  await tick();
});
