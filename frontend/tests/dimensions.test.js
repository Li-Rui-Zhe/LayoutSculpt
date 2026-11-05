import test from "node:test";
import assert from "node:assert/strict";
import {
  calibrate,
  dimensionStatus,
  furnitureSizeStatus,
} from "../src/editor/dimensions.js";
import { previewKey } from "../src/editor/previewIdentity.js";
import { toDraft } from "../src/editor/geometry.js";

const make = () => ({
  layout: {
    title: "测试",
    scale_note: "",
    outline: [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 4 },
      { x: 0, y: 4 },
    ],
    rooms: [
      {
        id: "room",
        polygon: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 4 },
          { x: 0, y: 4 },
        ],
      },
    ],
    walls: [
      {
        id: "a",
        edit_id: "a",
        start: { x: 0, y: 0 },
        end: { x: 5, y: 0 },
        thickness: 0.1,
        height: 2.8,
      },
      {
        id: "b",
        edit_id: "b",
        start: { x: 5, y: 0 },
        end: { x: 5, y: 4 },
        thickness: 0.1,
        height: 2.8,
      },
    ],
    openings: [{ wall_id: "a", offset: 1, width: 0.9, height: 2.1, bottom: 0 }],
    lights: [{ x: 2, y: 2, height: 2.6 }],
    presentation_layers: [
      { id: "decor", x: 1, y: 1, width: 0.2, depth: 0.3, height: 0.4 },
    ],
  },
  furniture: {
    items: [
      {
        edit_id: "table",
        name: "桌子",
        x: 2,
        y: 2,
        width: 1.5,
        depth: 0.8,
        height: 0.75,
        rotation: 0,
        size_reference: {
          source: "product",
          width: 1.5,
          depth: 0.8,
          height: 0.75,
        },
      },
      {
        edit_id: "pc",
        parent_furniture_id: "table",
        x: 2.2,
        y: 2,
        width: 0.3,
        depth: 0.2,
        height: 0.5,
        elevation: 0.75,
        rotation: 0,
      },
    ],
    notes: [],
  },
});

test("校准只缩放建筑平面并移动家具，商品尺寸、联动相对位置和高度保留", () => {
  const source = make(),
    next = calibrate(source, 5, 10, {
      wallId: "a",
      source: "measured",
      secondWallId: "b",
      secondActual: 8,
    });
  assert.equal(next.layout.walls[0].end.x, 10);
  assert.equal(next.layout.walls[0].height, 2.8);
  assert.equal(next.layout.openings[0].width, 1.8);
  assert.equal(next.furniture.items[0].width, 1.5);
  assert.equal(next.furniture.items[0].x, 4);
  assert.ok(Math.abs(next.furniture.items[1].x - 4.2) < 1e-9);
  assert.equal(next.furniture.items[1].elevation, 0.75);
  assert.equal(next.layout.presentation_layers[0].x, 2);
  assert.equal(source.furniture.items[0].x, 2);
  assert.match(dimensionStatus(next.layout).label, /两向/);
  assert.match(furnitureSizeStatus(next.furniture.items[0]), /用户录入商品/);
});
test("非法参考、过期墙长、两向比例冲突和锁定对象均不静默改变设计", () => {
  const source = make(),
    saved = JSON.stringify(source);
  for (const value of [0, -1, NaN, Infinity, 61])
    assert.throws(() => calibrate(source, 5, value));
  assert.throws(() => calibrate(source, 5, 10, { wallId: "missing" }));
  assert.throws(() => calibrate(source, 4, 10, { wallId: "a" }));
  assert.throws(() =>
    calibrate(source, 5, 10, {
      wallId: "a",
      secondWallId: "a",
      secondActual: 10,
    }),
  );
  assert.throws(
    () =>
      calibrate(source, 5, 10, {
        wallId: "a",
        secondWallId: "b",
        secondActual: 6,
      }),
    /比例相差/,
  );
  assert.equal(JSON.stringify(source), saved);
  assert.throws(() => calibrate(source, 5, 1, { wallId: "a" }), /墙厚/);
  source.furniture.items[0].x = 35;
  assert.throws(() => calibrate(source, 5, 10, { wallId: "a" }), /坐标范围/);
  source.furniture.items[0].x = 2;
  source.furniture.items[0].edit_locked = true;
  assert.throws(() => calibrate(source, 5, 10, { wallId: "a" }), /锁定|解锁/);
});
test("参考长度后来变化或被删除会提示重新校准，不能沿用有效标签", () => {
  const next = calibrate(make(), 5, 5, { wallId: "a", source: "drawing" });
  next.layout.walls[0].end.x = 6;
  assert.match(dimensionStatus(next.layout).label, /重新校准/);
  next.layout.walls = [];
  assert.match(dimensionStatus(next.layout).label, /重新校准/);
});
test("家具改尺寸后确认依据失效，旧数据不凭空升级为实测", () => {
  const item = make().furniture.items[0];
  item.width = 1.6;
  assert.match(furnitureSizeStatus(item), /重新核对/);
  assert.match(dimensionStatus(make().layout).label, /待核实/);
  assert.match(
    dimensionStatus({ scale_note: "暂按建筑长边 10 米估算" }).label,
    /估算/,
  );
  assert.match(
    dimensionStatus({
      dimension_basis: { source: "image_dimensions", inconsistent: true },
    }).label,
    /不一致/,
  );
});
test("记录尺寸依据能恢复且不会单独触发三维重建", () => {
  const before = make(),
    after = structuredClone(before);
  after.layout.dimension_basis = {
    source: "image_dimensions",
    anchors: [],
    inconsistent: false,
  };
  after.furniture.items[0].size_reference.source = "measured";
  assert.equal(previewKey(before), previewKey(after));
  const restored = toDraft({
    ...after.layout,
    furniture: after.furniture.items,
  });
  assert.deepEqual(
    restored.layout.dimension_basis,
    after.layout.dimension_basis,
  );
  assert.equal(restored.furniture.items[0].size_reference.source, "measured");
  after.furniture.items[0].width += 0.001;
  assert.notEqual(previewKey(before), previewKey(after));
});
