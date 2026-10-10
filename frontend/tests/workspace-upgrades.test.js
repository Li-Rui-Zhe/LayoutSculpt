import test from "node:test";
import assert from "node:assert/strict";
import { createDraftSession } from "../src/hooks/draftSession.js";
import { batchFurniture } from "../src/editor/batch.js";
import {
  calibrate,
  wallSides,
  snapFurniture,
} from "../src/editor/designTools.js";
import {
  identifyObjects,
  lockedChange,
  designFingerprint,
} from "../src/editor/objectIdentity.js";
import { materialTargets } from "../src/diy/colors.js";

test("草稿跨项目保存互不串修订号，连续修改仅保存最新值", async () => {
  const calls = [];
  let release;
  const write = async (key, body) => {
    calls.push({ key, ...body });
    if (key === "a" && body.revision === 3)
      await new Promise((r) => (release = r));
    return {
      revision: body.revision + 1,
      updated_at: new Date().toISOString(),
    };
  };
  const a = createDraftSession("a", 3, write, () => {}, 10000),
    b = createDraftSession("b", 0, write, () => {}, 10000);
  a.schedule({ x: 1 });
  const first = a.flush();
  await Promise.resolve();
  a.schedule({ x: 2 });
  a.schedule({ x: 3 });
  b.schedule({ x: 8 });
  await b.flush();
  release();
  await first;
  assert.deepEqual(
    calls.map((v) => [v.key, v.revision, v.document.x]),
    [
      ["a", 3, 1],
      ["b", 0, 8],
      ["a", 4, 3],
    ],
  );
  await a.flush();
});
test("草稿遇到修订冲突后停止自动覆盖", async () => {
  let calls = 0;
  const statuses = [];
  const s = createDraftSession(
    "a",
    0,
    async () => {
      calls++;
      throw Error("冲突");
    },
    (v) => statuses.push(v),
    10000,
  );
  s.schedule({ x: 1 });
  await s.flush();
  s.schedule({ x: 2 });
  await s.flush();
  assert.equal(calls, 1);
  assert.equal(statuses.at(-1).error, "冲突");
});
const document = () => ({
  layout: {
    outline: [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ],
    rooms: [
      {
        id: "r",
        name: "客厅",
        polygon: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
      },
    ],
    walls: [
      {
        id: "w",
        start: { x: 0, y: 0 },
        end: { x: 5, y: 0 },
        thickness: 0.1,
        height: 2.8,
      },
    ],
    openings: [],
    lights: [],
  },
  furniture: {
    notes: [],
    items: [
      {
        name: "椅",
        room_id: "r",
        x: 1,
        y: 1,
        width: 0.5,
        depth: 0.5,
        height: 1,
        rotation: 0,
      },
      {
        name: "桌",
        room_id: "r",
        x: 2,
        y: 2,
        width: 0.5,
        depth: 0.5,
        height: 1,
        rotation: 0,
        edit_locked: true,
      },
    ],
  },
});
test("批量操作保留锁定家具，组合与删除不改原文档", () => {
  const source = document();
  const moved = batchFurniture(source, [0, 1], "move", { x: 0.2 });
  assert.equal(moved.furniture.items[0].x, 1.2);
  assert.equal(moved.furniture.items[1].x, 2);
  assert.equal(source.furniture.items[0].x, 1);
  const grouped = batchFurniture(source, [0, 1], "group");
  assert.ok(grouped.furniture.items[0].edit_group);
  assert.equal(grouped.furniture.items[1].edit_group, undefined);
  assert.equal(
    batchFurniture(source, [0, 1], "delete").furniture.items.length,
    1,
  );
});
test("尺寸校准缩放平面且保留高度；墙A面按房间归属显示", () => {
  const source = document(),
    next = calibrate(source, 5, 10);
  assert.equal(next.layout.walls[0].end.x, 10);
  assert.equal(next.layout.walls[0].height, 2.8);
  assert.equal(next.furniture.items[0].width, 1);
  assert.equal(source.layout.walls[0].end.x, 5);
  assert.equal(
    wallSides(source.layout.walls[0], source.layout.rooms)[0].room,
    "客厅",
  );
  assert.throws(() => calibrate(source, 0, 5));
});

test("稳定对象身份防止复制冲突，锁定保护联动编辑，编辑元数据不影响交付差异", () => {
  const source = identifyObjects(document(), true),
    next = structuredClone(source);
  next.furniture.items.push(structuredClone(next.furniture.items[0]));
  identifyObjects(next);
  assert.notEqual(
    next.furniture.items[0].edit_id,
    next.furniture.items.at(-1).edit_id,
  );
  next.furniture.items[1].x += 1;
  assert.ok(lockedChange(source, next));
  const unlocked = structuredClone(source);
  unlocked.furniture.items[1].edit_locked = false;
  assert.equal(lockedChange(source, unlocked), "");
  assert.deepEqual(designFingerprint(source), designFingerprint(unlocked));
});

test("同材质匹配区分不同材质的相同颜色，斜墙吸附保留沿墙坐标", () => {
  const parts = [
    { id: "a", color: "#fff", material_id: "wood" },
    { id: "b", color: "#fff", material_id: "stone" },
    { id: "c", color: "#000", material_id: "wood" },
  ];
  assert.deepEqual(materialTargets({ parts }, "a", "matching"), ["a", "c"]);
  const d = document();
  d.layout.walls[0].end = { x: 5, y: 5 };
  d.furniture.items[0] = { ...d.furniture.items[0], x: 1, y: 1.65 };
  const next = snapFurniture(d, 0),
    a = d.furniture.items[0],
    b = next.furniture.items[0];
  assert.ok(Math.abs(b.x + b.y - a.x - a.y) < 1e-8);
  assert.ok(Math.abs(b.y - b.x - (0.5 + Math.SQRT2 * 0.055)) < 1e-6);
});
