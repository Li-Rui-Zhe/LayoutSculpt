import test from "node:test";
import assert from "node:assert/strict";
import {
  furniturePlacementAt,
  commitFurniturePlacement,
  placeLibraryFurniture,
} from "../src/library/placement.js";
const polygon = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 6 },
  { x: 0, y: 6 },
];
const doc = () => ({
  layout: {
    rooms: [{ id: "r", name: "客厅", polygon }],
    walls: [],
    openings: [],
  },
  furniture: { items: [] },
});
const chair = {
  kind: "chair",
  width: 0.5,
  depth: 0.5,
  height: 0.8,
  elevation: 0,
};
test("预览不修改原稿，确认按落点新增且可旋转", () => {
  const d = doc(),
    original = structuredClone(d);
  const result = furniturePlacementAt(d, chair, { x: 2, y: 3 }, 90);
  assert.equal(result.valid, true);
  assert.deepEqual(d, original);
  const next = commitFurniturePlacement(d, chair, { x: 2, y: 3 }, 90);
  assert.equal(next.furniture.items.length, 1);
  assert.deepEqual(next.furniture.items[0], {
    ...chair,
    x: 2,
    y: 3,
    rotation: 90,
    room_id: "r",
  });
  assert.deepEqual(d, original);
});
test("拒绝越界、凹空间跨边界与同高度重叠", () => {
  const d = doc();
  assert.equal(furniturePlacementAt(d, chair, { x: 0.1, y: 2 }).valid, false);
  d.furniture.items.push({ ...chair, x: 2, y: 2, rotation: 0, room_id: "r" });
  assert.equal(furniturePlacementAt(d, chair, { x: 2, y: 2 }).valid, false);
  assert.throws(
    () => commitFurniturePlacement(d, chair, { x: 2, y: 2 }),
    /重叠/,
  );
  d.layout.rooms[0].polygon = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 4 },
    { x: 0, y: 4 },
  ];
  assert.equal(
    furniturePlacementAt(d, { ...chair, width: 2, depth: 2 }, { x: 1, y: 1 })
      .valid,
    false,
  );
});
test("地毯和垂直分离允许叠放，隐藏家具仍占位", () => {
  const d = doc();
  d.furniture.items.push({
    ...chair,
    x: 2,
    y: 2,
    rotation: 0,
    edit_hidden: true,
  });
  assert.equal(furniturePlacementAt(d, chair, { x: 2, y: 2 }).valid, false);
  assert.equal(
    furniturePlacementAt(
      d,
      { ...chair, kind: "rug", height: 0.03 },
      { x: 2, y: 2 },
    ).valid,
    true,
  );
  assert.equal(
    furniturePlacementAt(d, { ...chair, elevation: 1.2 }, { x: 2, y: 2 }).valid,
    true,
  );
});
test("墙体及门口通行区阻止放置；自动找位避开家具", () => {
  const d = doc();
  d.layout.walls.push({
    id: "w",
    start: { x: 0, y: 0 },
    end: { x: 6, y: 0 },
    thickness: 0.2,
    height: 2.8,
  });
  d.layout.openings.push({
    kind: "door",
    wall_id: "w",
    offset: 2.5,
    width: 1,
    height: 2.1,
    bottom: 0,
  });
  assert.equal(furniturePlacementAt(d, chair, { x: 3, y: 0.6 }).valid, false);
  d.furniture.items.push({ ...chair, x: 3, y: 3, rotation: 0 });
  const next = placeLibraryFurniture(d, chair, "r");
  const item = next.furniture.items.at(-1);
  assert.equal(furniturePlacementAt(d, chair, item, item.rotation).valid, true);
  assert.equal(d.furniture.items.length, 1);
});
test("数量、尺寸和离地高度限制在预览及确认时检查", () => {
  const d = doc();
  for (const template of [
    { ...chair, width: NaN },
    { ...chair, depth: 7 },
    { ...chair, elevation: 4 },
  ]) {
    assert.equal(
      furniturePlacementAt(d, template, { x: 3, y: 3 }).valid,
      false,
    );
  }
  d.furniture.items = Array.from({ length: 90 }, () => ({
    ...chair,
    x: 1,
    y: 1,
    rotation: 0,
  }));
  assert.match(furniturePlacementAt(d, chair, { x: 3, y: 3 }).message, /90/);
});
test("壁挂电视只吸附落点附近的完整墙面，避开窗户", () => {
  const d = doc(),
    tv = {
      ...chair,
      kind: "wall_television",
      width: 1.2,
      depth: 0.1,
      height: 0.7,
      elevation: 1.05,
    };
  d.layout.walls.push({
    id: "w",
    start: { x: 0, y: 0 },
    end: { x: 6, y: 0 },
    thickness: 0.2,
    height: 2.8,
  });
  const good = furniturePlacementAt(d, tv, { x: 3, y: 0.4 });
  assert.equal(good.valid, true);
  assert.ok(good.item.y < 0.2);
  assert.equal(furniturePlacementAt(d, tv, { x: 3, y: 3 }).valid, false);
  d.layout.openings.push({
    kind: "window",
    wall_id: "w",
    offset: 2,
    width: 2,
    bottom: 0.8,
    height: 1.4,
  });
  assert.equal(furniturePlacementAt(d, tv, { x: 3, y: 0.4 }).valid, false);
});
