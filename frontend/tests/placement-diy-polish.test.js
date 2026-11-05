import test from "node:test";
import assert from "node:assert/strict";
import {
  furniturePlacementAt,
  placeLibraryFurniture,
} from "../src/library/placement.js";
import { placementInspector } from "../src/editor/placementFeedback.js";
import {
  furnitureSpace,
  reconcileFurnitureRoom,
} from "../src/editor/geometry.js";
import { furnitureCollision } from "../src/editor/placementRules.js";
import { applySurface } from "../src/editor/applySurface.js";
import {
  lockedPartChange,
  reconnectDiyDraft,
} from "../src/diy/draftRecovery.js";
import { createDraftReconnect } from "../src/hooks/draftReconnect.js";
import { restoreDraft } from "../src/hooks/restoreDraft.js";
import {
  buildRefreshUrl,
  cleanBuildRefreshUrl,
} from "../src/hooks/buildRefresh.js";

const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const wall = () => ({
  id: "w",
  start: { x: 3, y: 0 },
  end: { x: 3, y: 6 },
  height: 2.8,
  thickness: 0.2,
});
const document = () => ({
  layout: {
    outline: rect(0, 0, 6, 6),
    rooms: [
      { id: "living", name: "客厅", polygon: rect(0, 0, 3, 6) },
      { id: "dining", name: "餐厅", polygon: rect(3, 0, 6, 6) },
    ],
    walls: [],
    openings: [],
    lights: [],
  },
  furniture: { items: [], notes: [] },
});
const chair = {
  kind: "chair",
  width: 0.5,
  depth: 0.5,
  height: 0.8,
  elevation: 0,
  rotation: 0,
  x: 3,
  y: 3,
  room_id: "living",
};

test("更新入口绕过旧缓存，保留项目和选中对象，加载后清理临时标记", () => {
  const href =
    "http://127.0.0.1:8000/?project=test&object=walls%3Anorth#workspace";
  const updated = buildRefreshUrl(href, "/assets/index-new.js");
  assert.equal(
    new URL(updated).searchParams.get("_ls_build"),
    "/assets/index-new.js",
  );
  assert.equal(cleanBuildRefreshUrl(updated), href);
});

test("开放客餐厅可跨分区放置和拖动，归属随中心更新，实墙仍阻挡", () => {
  const doc = document();
  assert.equal(furniturePlacementAt(doc, chair, { x: 3.1, y: 3 }).valid, true);
  const moved = { ...chair, x: 3.1 };
  reconcileFurnitureRoom(doc, moved);
  assert.equal(moved.room_id, "dining");
  doc.furniture.items.push(moved);
  assert.equal(
    placementInspector(doc)(doc, { type: "furniture", index: 0 }).warning,
    false,
  );
  doc.layout.walls.push(wall());
  assert.equal(furniturePlacementAt(doc, chair, { x: 3, y: 4 }).valid, false);
  assert.equal(furnitureSpace(doc.layout)(moved), null);
  doc.layout.walls[0].edit_hidden = true;
  assert.equal(furniturePlacementAt(doc, chair, { x: 3, y: 4 }).valid, true);
});

test("空间并集不填平缺口，也不容许家具跨两个不连接的房间", () => {
  const doc = document();
  doc.layout.rooms[1].polygon = rect(3.2, 0, 6, 6);
  assert.equal(furnitureSpace(doc.layout)(chair), null);
  doc.layout.rooms = [
    {
      id: "living",
      polygon: [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 6 },
        { x: 0, y: 6 },
      ],
    },
  ];
  assert.equal(
    furnitureSpace(doc.layout)({ ...chair, x: 1, y: 1, width: 1, depth: 1 }),
    null,
  );
});

test("门口按高度保留通行区，窗洞按真实上下沿检查，隐藏开口恢复实墙", () => {
  const doc = document();
  doc.layout.walls.push(wall());
  const opening = {
    wall_id: "w",
    offset: 2,
    width: 2,
    bottom: 0,
    height: 2.1,
    kind: "door",
  };
  doc.layout.openings.push(opening);
  const at = (template, x = 3.5) =>
    furniturePlacementAt(doc, template, { x, y: 3 }).valid;
  assert.equal(at(chair), false);
  assert.equal(at({ ...chair, elevation: 2.2, height: 0.3 }), true);
  opening.kind = "window";
  opening.bottom = 1;
  opening.height = 1.5;
  assert.equal(at(chair, 3), false);
  assert.equal(at({ ...chair, elevation: 1.1, height: 0.3 }, 3), true);
  assert.equal(at({ ...chair, elevation: 2.3, height: 0.3 }, 3), false);
  opening.edit_hidden = true;
  assert.equal(at({ ...chair, elevation: 1.1, height: 0.3 }, 3), false);
});

test("餐椅浅入桌沿允许，深度重叠拒绝，隐藏和不同高度不误报", () => {
  const table = {
    ...chair,
    kind: "table",
    width: 2,
    depth: 1,
    height: 0.75,
    x: 2,
    y: 2,
  };
  const seat = { ...chair, x: 2, y: 2.65 };
  assert.equal(furnitureCollision(table, seat), false);
  assert.equal(furnitureCollision(table, { ...seat, y: 2.4 }), true);
  assert.equal(
    furnitureCollision(table, { ...seat, y: 2, edit_hidden: true }),
    false,
  );
  assert.equal(
    furnitureCollision(table, { ...seat, y: 2, elevation: 1 }),
    false,
  );
  const doc = document();
  doc.furniture.items = [table];
  assert.equal(
    furniturePlacementAt(doc, seat, { x: seat.x, y: seat.y }).valid,
    true,
  );
  doc.furniture.items.push(seat);
  assert.equal(
    placementInspector(doc)(doc, { type: "furniture", index: 1 }).warning,
    false,
  );
});

test("自动柜子靠墙、餐椅朝桌，原稿和已有家具保持不变", () => {
  const doc = document();
  doc.layout.walls = [
    { ...wall(), start: { x: 0, y: 0 }, end: { x: 6, y: 0 } },
  ];
  const original = structuredClone(doc);
  const cabinet = placeLibraryFurniture(
    doc,
    { ...chair, kind: "cabinet", width: 1, depth: 0.6, height: 1.8 },
    "living",
  ).furniture.items.at(-1);
  assert.ok(cabinet.y < 0.5);
  assert.deepEqual(doc, original);
  doc.furniture.items = [
    { ...chair, kind: "table", x: 1.5, y: 3, width: 1, depth: 1, height: 0.75 },
  ];
  const next = placeLibraryFurniture(doc, chair, "living");
  assert.equal(next.furniture.items[1].x, 1.5);
  assert.equal(next.furniture.items[1].rotation, 0);
  assert.deepEqual(next.furniture.items[0], doc.furniture.items[0]);
});

test("材质只应用指定房间和墙侧，保留原稿可撤销，过期或锁定目标拒绝", () => {
  const doc = document();
  doc.layout.walls = [
    {
      ...wall(),
      material_left: "a",
      material_right: "b",
      wall_material: "old",
    },
  ];
  const original = structuredClone(doc);
  const floor = applySurface(doc, {
    category: "floor",
    materialId: "custom:floor",
    targetId: "living",
  });
  assert.equal(floor.document.layout.rooms[0].floor_material, "custom:floor");
  assert.equal(floor.document.layout.rooms[1].floor_material, undefined);
  assert.deepEqual(floor.selection, { type: "rooms", index: 0 });
  const request = {
    category: "walls",
    materialId: "custom:wall",
    targetId: "w",
    side: "right",
  };
  assert.deepEqual(applySurface(doc, request).document.layout.walls[0], {
    ...doc.layout.walls[0],
    material_right: "custom:wall",
  });
  const both = applySurface(doc, { ...request, side: "both" }).document.layout
    .walls[0];
  assert.equal(both.wall_material, "custom:wall");
  assert.equal(both.material_left, null);
  assert.equal(both.material_right, null);
  assert.deepEqual(doc, original);
  assert.throws(
    () => applySurface(doc, { ...request, targetId: "gone" }),
    /目标位置/,
  );
  doc.layout.walls[0].edit_locked = true;
  assert.throws(() => applySurface(doc, request), /锁定/);
  doc.layout.walls[0].edit_locked = false;
  doc.layout.walls[0].edit_hidden = true;
  assert.throws(() => applySurface(doc, request), /目标位置/);
});

test("DIY 首读断线后自动重连，保留读取期间的部件修改并合并远端名称", async () => {
  const base = { name: "桌子", parts: [{ id: "top", width: 1 }] };
  const local = structuredClone(base);
  const remote = { ...base, name: "工作桌" };
  let calls = 0,
    done;
  const completed = new Promise((resolve) => {
    done = resolve;
  });
  const c = createDraftReconnect(
    async () => {
      if (++calls === 1) throw Error("断线");
      return { revision: 2, document: remote };
    },
    (value) =>
      done(restoreDraft({ document: local, baseDocument: base }, value, base)),
    10,
  );
  const timer = setTimeout(() => done(null), 1000);
  await c.retry();
  local.parts[0].width = 1.4;
  const result = await completed;
  clearTimeout(timer);
  c.close();
  assert.equal(calls, 2);
  assert.equal(result.conflict, false);
  assert.equal(result.document.parts[0].width, 1.4);
  assert.equal(result.document.name, "工作桌");
});

test("DIY 同一部件冲突保留本地，恢复不得覆盖锁定部件", () => {
  const base = { parts: [{ id: "top", width: 1 }] };
  const local = { parts: [{ id: "top", width: 1.4, edit_locked: true }] };
  const remote = { parts: [{ id: "top", width: 1.2 }] };
  const result = restoreDraft(
    { document: local, baseDocument: base },
    { document: remote },
    base,
  );
  assert.equal(result.conflict, true);
  assert.deepEqual(result.document, local);
  assert.equal(lockedPartChange(local, remote), true);
  assert.equal(lockedPartChange(local, { parts: [] }), true);
  assert.equal(
    lockedPartChange(local, {
      parts: [{ id: "top", width: 1.4, edit_locked: false }],
    }),
    false,
  );
});

test("DIY 冲突后继续编辑和刷新仍需选择，不能把未选择的远端版本当作已同步", () => {
  const base = { parts: [{ id: "top", width: 1 }] };
  const local = { parts: [{ id: "top", width: 1.4 }] };
  const remote = {
    revision: 3,
    document: { parts: [{ id: "top", width: 1.2 }] },
  };
  const first = reconnectDiyDraft(local, remote, base, null);
  assert.deepEqual(first.alternative, remote.document);
  assert.deepEqual(first.baseDocument, base);
  const edited = { parts: [{ id: "top", width: 1.6 }] };
  const reloaded = reconnectDiyDraft(
    edited,
    remote,
    first.baseDocument,
    first.alternative,
  );
  assert.deepEqual(reloaded.document, edited);
  assert.deepEqual(reloaded.alternative, remote.document);
  const accepted = reconnectDiyDraft(edited, remote, remote.document, null);
  assert.equal(accepted.alternative, null);
  assert.deepEqual(accepted.document, edited);
  const pending = reconnectDiyDraft(base, remote, base, null, true, true);
  assert.deepEqual(pending.document, base);
  assert.deepEqual(pending.alternative, remote.document);
});
