import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  followAttachments,
  attachmentError,
  parentOptions,
} from "../src/editor/attachments.js";
import { placementInspector } from "../src/editor/placementFeedback.js";
import { versionChanges } from "../src/components/versionDiff.js";
import { bindLiveLayers, syncLiveLayers } from "../src/editor/liveLayers.js";
import { canSyncLiveScene } from "../src/editor/liveSceneUpdates.js";
import { lockedChange } from "../src/editor/objectIdentity.js";

function fixture() {
  return {
    layout: {
      outline: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 6 },
        { x: 0, y: 6 },
      ],
      rooms: [
        {
          id: "r",
          polygon: [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
            { x: 8, y: 6 },
            { x: 0, y: 6 },
          ],
        },
      ],
      walls: [],
      openings: [],
      lights: [],
      presentation_layers: [],
    },
    furniture: {
      items: [
        {
          edit_id: "table",
          name: "桌子",
          room_id: "r",
          kind: "table",
          x: 2,
          y: 2,
          width: 2,
          depth: 1,
          height: 0.8,
          elevation: 0,
          rotation: 0,
        },
        {
          edit_id: "plant",
          name: "花瓶",
          room_id: "r",
          kind: "plant",
          x: 2.5,
          y: 2,
          width: 0.2,
          depth: 0.2,
          height: 0.3,
          elevation: 0.8,
          rotation: 0,
          parent_furniture_id: "table",
        },
      ],
    },
  };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test("父家具平移旋转与高度联动，孩子尺寸不变且不会二次累计", () => {
  const before = fixture(),
    next = structuredClone(before);
  Object.assign(next.furniture.items[0], {
    x: 4,
    y: 3,
    rotation: 90,
    height: 1,
  });
  const actual = followAttachments(before, next),
    child = actual.furniture.items[1];
  close(child.x, 4);
  close(child.y, 3.5);
  close(child.elevation, 1);
  close(child.rotation, 90);
  assert.equal(child.width, 0.2);
  assert.equal(before.furniture.items[1].x, 2.5);
  assert.deepEqual(followAttachments(before, actual), actual);
});
test("新绑定与明确移动孩子保持原位，删除父家具解除关系", () => {
  const before = fixture(),
    next = structuredClone(before);
  next.furniture.items[1].x = 5;
  next.furniture.items[0].x = 4;
  assert.equal(followAttachments(before, next).furniture.items[1].x, 5);
  delete before.furniture.items[1].parent_furniture_id;
  assert.equal(followAttachments(before, next).furniture.items[1].x, 5);
  const removed = fixture();
  removed.furniture.items.shift();
  assert.equal(
    followAttachments(fixture(), removed).furniture.items[0]
      .parent_furniture_id,
    null,
  );
});
test("循环禁止、候选过滤与锁定孩子保护", () => {
  const doc = fixture();
  assert.equal(parentOptions(doc, doc.furniture.items[0]).length, 0);
  doc.furniture.items[0].parent_furniture_id = "plant";
  assert.match(attachmentError(doc), /循环/);
  assert.throws(() => followAttachments(fixture(), doc), /循环/);
  const before = fixture();
  before.furniture.items[1].edit_locked = true;
  const next = structuredClone(before);
  next.furniture.items[0].x++;
  assert.match(lockedChange(before, followAttachments(before, next)), /锁定/);
});
test("多级依附与区域陈设随同一父家具移动", () => {
  const before = fixture();
  before.furniture.items.push({
    ...before.furniture.items[1],
    edit_id: "leaf",
    parent_furniture_id: "plant",
    x: 2.55,
    elevation: 1.1,
  });
  before.layout.presentation_layers = [
    {
      id: "decor",
      parent_furniture_id: "table",
      x: 3,
      y: 2,
      elevation: 0.8,
      rotation: 0,
    },
  ];
  const next = structuredClone(before);
  next.furniture.items[0].x++;
  const result = followAttachments(before, next);
  close(result.furniture.items[2].x, 3.55);
  close(result.layout.presentation_layers[0].x, 4);
});
test("摆放检查考虑高度、隐藏对象、房间边界和门口", () => {
  const doc = fixture(),
    inspect = placementInspector(doc);
  assert.equal(inspect(doc, { type: "furniture", index: 1 }).warning, false);
  doc.furniture.items[1].elevation = 0;
  assert.match(inspect(doc, { type: "furniture", index: 1 }).text, /重叠/);
  doc.furniture.items[0].edit_hidden = true;
  assert.equal(inspect(doc, { type: "furniture", index: 1 }).warning, false);
  doc.furniture.items[1].x = 9;
  assert.match(inspect(doc, { type: "furniture", index: 1 }).text, /边界/);
  doc.layout.walls = [
    {
      id: "w",
      start: { x: 0, y: 0 },
      end: { x: 8, y: 0 },
      height: 2.7,
      thickness: 0.2,
    },
  ];
  doc.layout.openings = [
    { kind: "door", wall_id: "w", offset: 1, width: 1, height: 2.1 },
  ];
  Object.assign(doc.furniture.items[1], { x: 1.5, y: 0.3 });
  assert.match(
    placementInspector(doc)(doc, { type: "furniture", index: 1 }).text,
    /门口/,
  );
});
test("版本差异匹配旧对象，忽略无关编辑元数据，仍显示具体属性", () => {
  const a = {
    rooms: [{ id: "r", name: "客厅" }],
    furniture: [{ name: "桌子", x: 2, y: 2 }],
  };
  const b = structuredClone(a);
  b.rooms[0].edit_id = "rooms-r";
  b.furniture[0].edit_id = "furniture-0";
  b.furniture[0].edit_locked = true;
  assert.deepEqual(versionChanges(a, b), []);
  b.furniture[0].x = 3;
  assert.deepEqual(
    versionChanges(a, b).map((v) => v.fields),
    [["位置"]],
  );
  b.furniture = [];
  assert.equal(versionChanges(a, b)[0].action, "移除");
});
test("真实陈设网格绑定保持原位，修改位姿即时同步，缺网格不能假报同步", () => {
  const before = fixture();
  before.layout.presentation_layers = [
    { id: "decor", x: 2, y: 2, elevation: 0, rotation: 0, visible: true },
  ];
  const model = new THREE.Group(),
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
  mesh.userData.presentation_layer_id = "decor";
  mesh.position.set(1, 1, 1);
  model.add(mesh);
  model.updateMatrixWorld(true);
  const old = mesh.getWorldPosition(new THREE.Vector3());
  const groups = bindLiveLayers(model, before);
  model.updateMatrixWorld(true);
  assert.ok(mesh.getWorldPosition(new THREE.Vector3()).distanceTo(old) < 1e-8);
  const next = structuredClone(before);
  next.layout.presentation_layers[0].x += 2;
  syncLiveLayers(groups, next);
  model.updateMatrixWorld(true);
  close(mesh.getWorldPosition(new THREE.Vector3()).x, old.x + 2);
  assert.equal(canSyncLiveScene(before, next, { layerIds: ["decor"] }), true);
  assert.equal(canSyncLiveScene(before, next, {}), false);
  next.layout.presentation_layers[0].visible = false;
  syncLiveLayers(groups, next);
  assert.equal(groups.get("decor").visible, false);
});
