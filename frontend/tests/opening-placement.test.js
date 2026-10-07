import test from "node:test";
import assert from "node:assert/strict";
import {
  openingGaps,
  openingPosition,
  validateOpening,
} from "../src/editor/openingPlacement.js";
import { openingPoints } from "../src/editor/geometry.js";

const wall = {
  id: "w",
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
  height: 2.7,
};
const candidate = {
  wall_id: "w",
  kind: "door",
  width: 0.9,
  height: 2.1,
  bottom: 0,
  offset: 0.05,
  angle: 90,
};
const layout = (openings = [], target = wall) => ({
  walls: [target],
  openings,
});

test("1 米墙能放入 0.9 米门，正好占满墙长也允许，不强制隐藏留边", () => {
  assert.equal(openingPosition(layout(), wall, 0.9), 0.05);
  assert.deepEqual(validateOpening(layout(), candidate), []);
  assert.deepEqual(
    validateOpening(layout(), { ...candidate, width: 1, offset: 0 }),
    [],
  );
  assert.match(
    validateOpening(layout(), { ...candidate, width: 1.01, offset: 0 }).join(),
    /超出墙体/,
  );
});

test("可用墙段合并重叠占用、包含通道并裁切越界数据，不改变原始开口", () => {
  const original = [
    { ...candidate, offset: 0.3, width: 0.3, kind: "passage" },
    { ...candidate, offset: -1, width: 1.2 },
    { ...candidate, offset: 0.45, width: 0.25 },
    { ...candidate, wall_id: "other", offset: 0.7, width: 0.3 },
    { ...candidate, offset: 2, width: 1 },
  ];
  const before = JSON.stringify(original);
  assert.deepEqual(openingGaps(layout(original), wall), [
    { start: 0.2, end: 0.3 },
    { start: 0.7, end: 1 },
  ]);
  assert.equal(openingPosition(layout(original), wall, 0.2), 0.75);
  assert.equal(JSON.stringify(original), before);
});

test("斜墙与反向墙按实际长度定位，端点转换与安装校验一致", () => {
  for (const target of [
    { ...wall, start: { x: 0, y: 0 }, end: { x: 3, y: 4 } },
    { ...wall, start: { x: 3, y: 4 }, end: { x: 0, y: 0 } },
  ]) {
    const opening = { ...candidate, offset: 3, width: 2 };
    assert.deepEqual(validateOpening(layout([], target), opening), []);
    const [a, b] = openingPoints(opening, target);
    assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 2) < 1e-9);
    assert.deepEqual(b, target.end);
  }
});

test("拒绝重叠、顶部越界、负值、空输入及无效门扇角度，允许端点相接", () => {
  const occupied = { ...candidate, offset: 0, width: 0.4 };
  const d = layout([occupied]);
  assert.deepEqual(
    validateOpening(d, { ...candidate, offset: 0.4, width: 0.6 }),
    [],
  );
  assert.match(
    validateOpening(d, { ...candidate, offset: 0.39, width: 0.6 }).join(),
    /重叠/,
  );
  assert.match(
    validateOpening(layout(), {
      ...candidate,
      kind: "window",
      bottom: 0.9,
      height: 2,
    }).join(),
    /顶部/,
  );
  for (const invalid of [
    { width: NaN },
    { height: 0 },
    { offset: -0.1 },
    { bottom: -1 },
    { angle: NaN },
    { angle: 120 },
  ])
    assert.ok(validateOpening(layout(), { ...candidate, ...invalid }).length);
  assert.ok(
    validateOpening(
      layout(Array(80).fill({ ...candidate, wall_id: "other" })),
      candidate,
    ).length,
  );
  assert.ok(
    validateOpening(layout(), { ...candidate, wall_id: "missing" }).length,
  );
});
