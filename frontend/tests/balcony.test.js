import test from "node:test";
import assert from "node:assert/strict";
import {
  changeBoundary,
  boundaryFrameParts,
  boundaryProblems,
} from "../src/editor/balcony.js";

function document() {
  return {
    layout: {
      walls: [
        {
          id: "outer",
          start: { x: 0, y: 0 },
          end: { x: 4, y: 0 },
          thickness: 0.12,
          height: 2.7,
          exterior: true,
        },
        {
          id: "divider",
          start: { x: 0, y: 2 },
          end: { x: 4, y: 2 },
          thickness: 0.2,
          height: 2.7,
          exterior: false,
        },
      ],
      openings: [],
    },
  };
}

test("只调整选中的阳台外缘，总高和玻璃基座分别保存，原草稿可撤销", () => {
  const original = document();
  const next = changeBoundary(original, 0, "glass_railing");
  assert.equal(next.layout.walls[0].height, 1.1);
  assert.equal(next.layout.walls[0].sill_height, 0.15);
  assert.equal(original.layout.walls[0].height, 2.7);
  assert.deepEqual(next.layout.walls[1], original.layout.walls[1]);
  const enclosed = changeBoundary(next, 0, "glazing");
  assert.equal(enclosed.layout.walls[0].height, 2.7);
  assert.equal(enclosed.layout.walls[0].sill_height, 0);
});

test("栏板切换保护门窗、通道和承重墙，失败时不修改草稿", () => {
  const doc = document();
  doc.layout.openings.push({
    wall_id: "outer",
    offset: 0.5,
    width: 1,
    bottom: 0,
    height: 2.1,
  });
  const snapshot = structuredClone(doc);
  assert.throws(() => changeBoundary(doc, 0, "glass_railing"), /门窗或通道/);
  assert.throws(() => changeBoundary(doc, 0, "parapet"), /截断/);
  assert.deepEqual(doc, snapshot);
  doc.layout.walls[1].load_bearing = true;
  assert.throws(() => changeBoundary(doc, 1, "glazing"), /承重/);
});

test("玻璃基座必须低于围护总高，栏板不能安装门窗", () => {
  const doc = changeBoundary(document(), 0, "glass_railing");
  const wall = doc.layout.walls[0];
  assert.equal(boundaryProblems(wall, []), null);
  assert.match(boundaryProblems({ ...wall, sill_height: 1.1 }, []), /基座/);
  assert.match(boundaryProblems(wall, [{ wall_id: wall.id }]), /栏板不能/);
});

test("实时细框不超过栏板总高，封窗下方通道不被横梁或立柱堵住", () => {
  const doc = changeBoundary(document(), 0, "glass_railing");
  const wall = doc.layout.walls[0];
  const guard = boundaryFrameParts(wall);
  assert.ok(guard.length);
  assert.ok(
    guard.every(
      ([a, b, low, high]) => a >= 0 && b <= 4 && low >= 0.15 && high <= 1.1,
    ),
  );
  const parts = boundaryFrameParts(
    { ...wall, boundary_type: "glazing", height: 2.7, sill_height: 0 },
    [{ offset: 1, width: 2, bottom: 0, height: 2.1 }],
  );
  assert.ok(
    !parts.some(
      ([a, b, low, high]) =>
        Math.min(b, 3) - Math.max(a, 1) > 0.03 && low < 2.1 && high > 0,
    ),
  );
});
