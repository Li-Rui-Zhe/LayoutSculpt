import test from "node:test";
import assert from "node:assert/strict";
import { placeLibraryFurniture } from "../src/library/placement.js";
import { verticalOverlap } from "../src/library/wallPlacement.js";

test("壁挂电视靠完整墙面、朝室内安装，可处于低柜上方", () => {
  const doc = document();
  doc.layout.walls = [{id:"w",start:{x:0,y:0},end:{x:5,y:0},thickness:.16,height:2.7}];
  const tv = {kind:"wall_television", width:1.24,depth:.1,height:.71,elevation:1.05};
  doc.furniture.items = [{kind:"tv_console",x:2.5,y:.3,width:1.8,depth:.4,height:.52,rotation:0,room_id:"r"}];
  const placed = placeLibraryFurniture(doc, tv).furniture.items.at(-1);
  assert.equal(placed.rotation, 0);
  assert.ok(Math.abs(placed.y - .138) < .001);
  assert.equal(placed.elevation, 1.05);
  assert.equal(verticalOverlap(placed,doc.furniture.items[0]), false);
  assert.equal(verticalOverlap({...placed,elevation:.4},doc.furniture.items[0]), true);
  doc.layout.openings = [{wall_id:"w",kind:"window",offset:0,width:5,bottom:.5,height:1.8}];
  assert.throws(() => placeLibraryFurniture(doc,tv), /完整墙面/);
  doc.layout.openings = [];
  doc.layout.walls[0].height = 1.6;
  assert.throws(() => placeLibraryFurniture(doc,tv), /完整墙面/);
  assert.throws(() => placeLibraryFurniture(doc,{...tv,elevation:-1}), /离地高度/);
});
import {
  itemFits,
  furnitureCorners,
  overlapArea,
  restorableDraft,
} from "../src/editor/geometry.js";

const template = {
  kind: "model",
  name: "自选边柜",
  asset_id: `snapshot:${"a".repeat(64)}`,
  width: 1,
  depth: 0.5,
  height: 0.8,
};
function document() {
  const polygon = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 4 },
    { x: 0, y: 4 },
  ];
  return {
    layout: {
      outline: polygon,
      rooms: [{ id: "r", name: "客厅", polygon }],
      walls: [],
      openings: [],
    },
    furniture: { items: [], notes: [] },
  };
}
test("素材放置保留具体模型、避让现有家具，且不修改原草稿", () => {
  const original = document(),
    first = placeLibraryFurniture(original, template);
  const next = placeLibraryFurniture(first, template);
  assert.equal(original.furniture.items.length, 0);
  assert.equal(next.furniture.items.length, 2);
  assert.equal(next.furniture.items[1].asset_id, template.asset_id);
  assert.ok(itemFits(next.furniture.items[1], next.layout.rooms[0]));
  assert.ok(overlapArea(...next.furniture.items.map(furnitureCorners)) < 1e-6);
  assert.ok(restorableDraft(next));
});
test("放不下、没有空间、非法比例和数量超限会明确拒绝", () => {
  const doc = document();
  assert.throws(
    () => placeLibraryFurniture(doc, { ...template, width: 6, depth: 6 }),
    /空位/,
  );
  assert.throws(
    () => placeLibraryFurniture(doc, { ...template, width: 0 }),
    /尺寸/,
  );
  doc.layout.rooms = [];
  assert.throws(() => placeLibraryFurniture(doc, template), /空间/);
  doc.furniture.items = Array(90).fill(template);
  assert.throws(() => placeLibraryFurniture(doc, template), /90/);
});
test("新增家具避开实体墙和门前通行区", () => {
  const doc = document();
  doc.layout.walls = [
    { id: "w", start: { x: 0, y: 2 }, end: { x: 5, y: 2 }, thickness: 0.2 },
  ];
  doc.layout.openings = [{ wall_id: "w", kind: "door", offset: 2, width: 1 }];
  const item = placeLibraryFurniture(doc, template).furniture.items[0];
  assert.ok(Math.abs(item.y - 2) >= 0.8 - 1e-6);
});
