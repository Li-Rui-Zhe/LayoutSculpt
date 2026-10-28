import test from "node:test";
import assert from "node:assert/strict";
import {
  applyArchitecture,
  architectureItems,
  architectureCategories,
  openingReference,
  architectureSelection,
} from "../src/library/architectureCatalog.js";
import { readContext } from "../src/hooks/urlContext.js";
import { doorLeafSegments } from "../src/editor/geometry.js";

function fixture() {
  return {
    layout: {
      walls: [
        {
          id: "side",
          start: { x: 0, y: 0 },
          end: { x: 0, y: 3 },
          height: 2.7,
          thickness: 0.2,
          exterior: true,
        },
        {
          id: "outer",
          start: { x: 0, y: 3 },
          end: { x: 5.2, y: 3 },
          height: 2.7,
          thickness: 0.2,
          exterior: true,
          wall_material: "wall_white",
        },
      ],
      openings: [],
    },
    furniture: { items: [], notes: [] },
  };
}

test("从构件库应用到指定墙段，保留原长度、位置、其他墙与家具", () => {
  const doc = fixture(),
    snapshot = structuredClone(doc);
  const next = applyArchitecture(doc, "outer", {
    boundary_type: "glass_railing",
    height: 1.2,
    sill_height: 0.25,
    thickness: 0.1,
  });
  assert.equal(next.layout.walls[1].height, 1.2);
  assert.equal(next.layout.walls[1].sill_height, 0.25);
  assert.equal(next.layout.walls[1].boundary_type, "glass_railing");
  assert.deepEqual(next.layout.walls[1].start, snapshot.layout.walls[1].start);
  assert.deepEqual(next.layout.walls[1].end, snapshot.layout.walls[1].end);
  assert.deepEqual(next.layout.walls[0], snapshot.layout.walls[0]);
  assert.deepEqual(next.furniture, snapshot.furniture);
  assert.deepEqual(doc, snapshot);
});

test("构件参数校验保护基座、尺寸、锁定与已删除的墙段", () => {
  const doc = fixture(),
    glass = {
      boundary_type: "glazing",
      height: 2.7,
      sill_height: 0.6,
      thickness: 0.1,
    };
  assert.throws(() => applyArchitecture(doc, "missing", glass), /不存在/);
  assert.throws(
    () => applyArchitecture(doc, "outer", { ...glass, sill_height: 2.7 }),
    /基座/,
  );
  for (const height of ["", NaN, Infinity, 0.2, 4.6])
    assert.throws(
      () => applyArchitecture(doc, "outer", { ...glass, height }),
      /总高/,
    );
  doc.layout.walls[1].edit_locked = true;
  assert.throws(() => applyArchitecture(doc, "outer", glass), /锁定/);
});

test("按最终尺寸校验开口，矮栏板不截断门，封窗保留已有门洞", () => {
  const doc = fixture();
  doc.layout.openings.push({
    wall_id: "outer",
    offset: 1,
    width: 1,
    bottom: 0,
    height: 2.1,
  });
  assert.throws(
    () => applyArchitecture(doc, "outer", { boundary_type: "parapet" }),
    /截断/,
  );
  const tall = applyArchitecture(doc, "outer", {
    boundary_type: "glazing",
    height: 2.5,
    sill_height: 0,
  });
  assert.deepEqual(tall.layout.openings, doc.layout.openings);
  assert.equal(tall.layout.walls[1].height, 2.5);
  doc.layout.openings[0].edit_locked = true;
  assert.throws(
    () => applyArchitecture(doc, "outer", { boundary_type: "glazing" }),
    /锁定/,
  );
});

test("切换已有相同围护类型仍应用新尺寸，局部饰面不被截断", () => {
  const doc = fixture();
  doc.layout.walls[1].boundary_type = "parapet";
  const next = applyArchitecture(doc, "outer", {
    boundary_type: "parapet",
    height: 1.2,
  });
  assert.equal(next.layout.walls[1].height, 1.2);
  doc.layout.walls[1].finish_regions = [{ bottom: 1, height: 1 }];
  assert.throws(
    () => applyArchitecture(doc, "outer", { boundary_type: "parapet" }),
    /饰面/,
  );
});

test("建筑构件页签支持链接直达与刷新恢复，未知类型回退", () => {
  const before = globalThis.location;
  try {
    globalThis.location = new URL(
      "http://127.0.0.1:5173/?assetType=architecture#library",
    );
    assert.equal(readContext("assetType", "models"), "architecture");
    globalThis.location = new URL(
      "http://127.0.0.1:5173/?assetType=invalid#library",
    );
    assert.equal(readContext("assetType", "models"), "models");
  } finally {
    if (before === undefined) delete globalThis.location;
    else globalThis.location = before;
  }
});

test("五类住宅构件全部可用，17 个预设各自生成真实墙段或开口", () => {
  assert.equal(new Set(architectureItems.map((i) => i.id)).size, 17);
  assert.equal(architectureCategories.length, 6);
  for (const item of architectureItems) {
    const doc = fixture(),
      before = structuredClone(doc);
    const next = applyArchitecture(doc, "outer", { preset_id: item.id });
    if (item.opening) {
      assert.equal(next.layout.openings.length, 1);
      const opening = next.layout.openings[0];
      assert.equal(opening.kind, item.opening.kind);
      assert.equal(opening.width, item.opening.width);
      assert.deepEqual(next.layout.walls, doc.layout.walls);
      assert.deepEqual(
        architectureSelection(doc, next, "outer", { preset_id: item.id }),
        { type: "openings", index: 0 },
      );
    } else
      assert.equal(
        next.layout.walls[1].boundary_type,
        item.boundary_type || item.id,
      );
    assert.deepEqual(doc, before);
  }
});

test("平面图正确显示双开门和推拉门的两片门扇", () => {
  for (const id of ["double_door", "sliding_door"]) {
    const doc = fixture(),
      next = applyArchitecture(doc, "outer", { preset_id: id, angle: 0 });
    const segments = doorLeafSegments(
      next.layout.openings[0],
      next.layout.walls[1],
    );
    assert.equal(segments.length, 2);
    assert.ok(
      segments
        .flat()
        .every(
          (p) =>
            Number.isFinite(p.x) &&
            Number.isFinite(p.y) &&
            p.x >= 0 &&
            p.x <= 5.2,
        ),
    );
  }
});

test("门窗定位会避让已有开口，替换保留对象身份，删除或重排引用不误改其他开口", () => {
  const doc = fixture();
  doc.layout.openings = [
    {
      wall_id: "outer",
      kind: "window",
      offset: 0,
      width: 1.2,
      height: 1.4,
      bottom: 0.9,
      edit_id: "original",
    },
  ];
  const added = applyArchitecture(doc, "outer", { preset_id: "single_door" });
  assert.ok(added.layout.openings[1].offset >= 1.2);
  assert.deepEqual(added.layout.openings[0], doc.layout.openings[0]);
  const configuration = {
    preset_id: "sliding_window",
    opening_ref: openingReference(doc.layout.openings[0]),
    offset: 0,
    width: 1.2,
  };
  const replaced = applyArchitecture(doc, "outer", configuration);
  assert.equal(replaced.layout.openings.length, 1);
  assert.equal(replaced.layout.openings[0].edit_id, "original");
  assert.equal(replaced.layout.openings[0].window_style, "sliding");
  assert.deepEqual(
    architectureSelection(doc, replaced, "outer", configuration),
    { type: "openings", index: 0 },
  );
  assert.throws(
    () => applyArchitecture(fixture(), "outer", configuration),
    /原开口/,
  );
});

test("开口安装保护重叠、墙高、栏板、锁定、承重标记和数量上限", () => {
  const doc = fixture();
  doc.layout.openings = [
    {
      wall_id: "outer",
      kind: "passage",
      offset: 0,
      width: 2,
      height: 2.4,
      bottom: 0,
    },
  ];
  assert.throws(
    () =>
      applyArchitecture(doc, "outer", { preset_id: "fixed_window", offset: 1 }),
    /重叠/,
  );
  assert.throws(
    () =>
      applyArchitecture(doc, "outer", {
        preset_id: "fixed_window",
        height: 2,
        bottom: 1,
      }),
    /墙高/,
  );
  doc.layout.walls[1].boundary_type = "glass_railing";
  assert.throws(
    () => applyArchitecture(doc, "outer", { preset_id: "single_door" }),
    /栏板/,
  );
  doc.layout.walls[1].boundary_type = "wall";
  doc.layout.walls[1].load_bearing = true;
  assert.throws(
    () => applyArchitecture(doc, "outer", { preset_id: "single_door" }),
    /承重/,
  );
  doc.layout.walls[1].load_bearing = false;
  doc.layout.openings[0].edit_locked = true;
  assert.throws(
    () =>
      applyArchitecture(doc, "outer", {
        preset_id: "doorway",
        opening_ref: openingReference(doc.layout.openings[0]),
      }),
    /锁定/,
  );
  doc.layout.openings = Array.from({ length: 80 }, () => ({
    wall_id: "side",
    kind: "passage",
    offset: 0,
    width: 0.1,
    height: 0.1,
    bottom: 0,
  }));
  assert.throws(
    () => applyArchitecture(doc, "outer", { preset_id: "single_door" }),
    /80/,
  );
});
