import test from "node:test";
import assert from "node:assert/strict";
import { showerPlacementIssues } from "../src/editor/showerPlacement.js";
import { placeLibraryFurniture } from "../src/library/placement.js";

const corners = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: 3, y: 3 },
  { x: 0, y: 3 },
];
const document = () => ({
  layout: {
    rooms: [{ id: "bath", name: "卫生间", polygon: corners }],
    walls: corners.map((start, i) => ({
      id: `w${i}`,
      start,
      end: corners[(i + 1) % 4],
      thickness: 0.2,
      height: 2.7,
    })),
    openings: [
      {
        wall_id: "w1",
        kind: "window",
        offset: 0.3,
        width: 1.2,
        bottom: 1,
        height: 1.2,
      },
    ],
  },
  furniture: { items: [] },
});
const shower = {
  kind: "shower_walk_in",
  room_id: "bath",
  x: 2.3,
  y: 0.7,
  width: 1,
  depth: 1,
  height: 2.1,
  rotation: 0,
  elevation: 0,
};

test("窗边集成湿区保留采光，独立舱实体板被提示", () => {
  assert.deepEqual(showerPlacementIssues(shower, document()), []);
  assert.deepEqual(
    showerPlacementIssues({ ...shower, kind: "shower_open" }, document()),
    [],
  );
  assert.ok(
    showerPlacementIssues({ ...shower, kind: "shower" }, document()).some((s) =>
      s.includes("遮挡窗户"),
    ),
  );
  assert.ok(
    showerPlacementIssues({ ...shower, rotation: 90 }, document()).some((s) =>
      s.includes("完整实墙"),
    ),
  );
});
test("人工设计检查花洒安装窗洞、入口和尺寸", () => {
  const doc = document();
  doc.layout.openings.push({
    wall_id: "w0",
    kind: "window",
    offset: 2,
    width: 0.6,
    bottom: 1,
    height: 1,
  });
  assert.ok(
    showerPlacementIssues(shower, doc).some((s) => s.includes("完整实墙")),
  );
  doc.layout.openings.pop();
  doc.furniture.items.push({
    ...shower,
    kind: "cabinet",
    y: 1.55,
    width: 0.6,
    depth: 0.4,
  });
  assert.ok(
    showerPlacementIssues(shower, doc).some((s) => s.includes("入口受阻")),
  );
  assert.ok(
    showerPlacementIssues({ ...shower, width: 0.5 }, document()).some((s) =>
      s.includes("过小"),
    ),
  );
});
test("素材库淋浴自动靠实墙摆放且不挡入口", () => {
  for (const kind of ["shower_walk_in", "shower_open"]) {
    const doc = document();
    const placed = placeLibraryFurniture(doc, { ...shower, kind }, "bath");
    assert.equal(doc.furniture.items.length, 0);
    assert.equal(placed.furniture.items.length, 1);
    const item = placed.furniture.items[0];
    assert.deepEqual(showerPlacementIssues(item, placed), []);
  }
});

test("未指定空间时淋浴只自动放入卫生间", () => {
  const doc = document();
  assert.throws(() => placeLibraryFurniture(doc, shower), /选择淋浴区所属空间/);
  doc.layout.rooms[0].kind = "bathroom";
  const placed = placeLibraryFurniture(doc, shower);
  assert.equal(placed.furniture.items[0].room_id, "bath");
});
