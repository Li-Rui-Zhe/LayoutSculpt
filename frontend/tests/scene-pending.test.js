import test from "node:test";
import assert from "node:assert/strict";
import {
  pendingSceneObjects,
  sceneObjectSignature,
} from "../src/editor/scenePending.js";

const empty = () => ({
  layout: { rooms: [], walls: [], lights: [], openings: [] },
  furniture: { items: [] },
});
const furniture = (id, kind = "sofa") => ({
  edit_id: id,
  kind,
  name: "沙发",
  x: 2,
  y: 3,
  width: 2,
  depth: 1,
  height: 1,
  rotation: 0,
});

test("新增对象立即标记落点，实际显示快照一致后才结束等待", () => {
  const visible = empty(),
    current = empty();
  current.furniture.items.push(furniture("new"));
  const pending = pendingSceneObjects(visible, current);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].action, "add");
  assert.equal(pending[0].id, "new");
  assert.equal(
    pendingSceneObjects(visible, structuredClone(current)).length,
    1,
  );
  assert.deepEqual(pendingSceneObjects(current, current), []);
  assert.deepEqual(pendingSceneObjects(visible, visible), []);
});

test("移动、旋转、改尺寸和编辑元数据不制造等待，换模型和材质有反馈", () => {
  const visible = empty();
  visible.furniture.items.push(furniture("f"));
  const current = structuredClone(visible);
  Object.assign(current.furniture.items[0], {
    x: 8,
    y: 6,
    rotation: 90,
    width: 3,
    depth: 2,
    height: 1.5,
    elevation: 0.2,
    room_id: "r",
    edit_locked: true,
    name: "新名字",
  });
  assert.deepEqual(pendingSceneObjects(visible, current), []);
  current.furniture.items[0].asset_id = "new-model";
  assert.equal(pendingSceneObjects(visible, current)[0].action, "update");
  delete current.furniture.items[0].asset_id;
  current.furniture.items[0].material = "walnut";
  assert.equal(pendingSceneObjects(visible, current).length, 1);
});

test("稳定身份不受排序影响；删除、隐藏、关闭地板均不标记正在加载", () => {
  const visible = empty();
  visible.furniture.items.push(furniture("a"), furniture("b"));
  const current = structuredClone(visible);
  current.furniture.items.reverse();
  assert.deepEqual(pendingSceneObjects(visible, current), []);
  current.furniture.items[0].kind = "chair";
  assert.equal(pendingSceneObjects(visible, current)[0].id, "b");
  current.furniture.items[0].edit_hidden = true;
  assert.deepEqual(pendingSceneObjects(visible, current), []);
  current.furniture.items = [];
  current.layout.rooms.push({ id: "r", floor_enabled: false });
  assert.deepEqual(pendingSceneObjects(visible, current), []);
});

test("灯具、墙体、地板、门窗与通道独立追踪", () => {
  const current = empty();
  current.layout.lights.push({ id: "l", kind: "floor_lamp" });
  current.layout.walls.push({ id: "w" });
  current.layout.rooms.push({ id: "r" });
  current.layout.openings.push(
    { id: "d", kind: "door" },
    { id: "v", kind: "window" },
    { id: "p", kind: "passage" },
  );
  assert.deepEqual(
    pendingSceneObjects(empty(), current).map((p) => p.name),
    ["灯具 1", "墙体 1", "地板 1", "门 1", "窗户 2", "通道 3"],
  );
  const changed = structuredClone(current);
  changed.layout.rooms[0].floor_material = "oak";
  assert.equal(pendingSceneObjects(current, changed)[0].type, "rooms");
});

test("签名稳定但保留 DIY 部件可见性差异", () => {
  assert.equal(
    sceneObjectSignature({ kind: "bed", color: "white" }, "furniture"),
    sceneObjectSignature({ color: "white", kind: "bed" }, "furniture"),
  );
  const item = {
    ...furniture("diy"),
    diy: { parts: [{ edit_hidden: false }] },
  };
  const modified = structuredClone(item);
  modified.diy.parts[0].edit_hidden = true;
  assert.notEqual(
    sceneObjectSignature(item, "furniture"),
    sceneObjectSignature(modified, "furniture"),
  );
});
