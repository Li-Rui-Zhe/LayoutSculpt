import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { architectureItems } from "../src/library/architectureCatalog.js";
import {
  architecturePlacementAt,
  commitArchitecturePlacement,
} from "../src/editor/architecturePlacement.js";
import { architecturePointOnRay } from "../src/editor/scenePlacement.js";
import lightingCatalog from "../src/library/lightingCatalog.json" with { type: "json" };

test("六款灯具在落点确认后添加，保留光照参数；越界和数量上限不写入", () => {
  for (const preset of lightingCatalog) {
    const doc = fixture();
    const config = { light_kind: preset.kind };
    assert.equal(architecturePlacementAt(doc, config, null).valid, false);
    assert.equal(
      architecturePlacementAt(doc, config, { x: 99, y: 99 }).valid,
      false,
    );
    const result = architecturePlacementAt(doc, config, { x: 2, y: 2 });
    assert.equal(result.valid, true);
    const placed = commitArchitecturePlacement(result);
    const light = placed.document.layout.lights[0];
    assert.equal(light.kind, preset.kind);
    assert.equal(light.lumens, preset.lumens);
    assert.equal(light.elevation, preset.elevation);
    assert.ok(light.id.startsWith("light_"));
    assert.equal(doc.layout.lights.length, 0);
    doc.layout.lights = Array.from({ length: 12 }, (_, i) => ({
      ...light,
      id: String(i),
    }));
    assert.equal(
      architecturePlacementAt(doc, config, { x: 2, y: 2 }).valid,
      false,
    );
  }
});

function fixture() {
  const points = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 5 },
    { x: 0, y: 5 },
  ];
  return {
    layout: {
      outline: points,
      rooms: [{ id: "room", name: "客厅", kind: "living", polygon: points }],
      walls: points.map((p, i) => ({
        id: `w${i}`,
        start: p,
        end: points[(i + 1) % 4],
        height: 2.7,
        thickness: 0.16,
      })),
      openings: [],
      lights: [],
    },
    furniture: { items: [], notes: [] },
  };
}
test("17 种构件都能生成独立可编辑的放置结果，不修改原草稿", () => {
  for (const preset of architectureItems) {
    const doc = fixture(),
      before = structuredClone(doc);
    const config = { preset_id: preset.id };
    const result = architecturePlacementAt(
      doc,
      config,
      preset.opening ? { x: 3, y: 0 } : { x: 3, y: 2.5 },
      90,
    );
    assert.equal(result.valid, true, `${preset.name}: ${result.message}`);
    const placed = commitArchitecturePlacement(result);
    assert.equal(placed.document.layout.walls.length, preset.opening ? 4 : 5);
    assert.equal(
      placed.document.layout.openings.length,
      preset.opening ? 1 : 0,
    );
    const obj =
      placed.document.layout[placed.selection.type][placed.selection.index];
    assert.ok(obj.edit_id);
    if (!preset.opening) {
      assert.ok(obj.id.startsWith("manual_"));
      assert.equal(obj.start.x, obj.end.x);
    }
    assert.deepEqual(doc, before);
  }
});
test("门窗贴墙，重叠、锁定、矮墙和玻璃栏板禁止安装，取消不产生对象", () => {
  const doc = fixture();
  const config = {
    preset_id: architectureItems.find((p) => p.opening?.kind === "window").id,
  };
  assert.equal(architecturePlacementAt(doc, config, null).valid, false);
  assert.equal(
    architecturePlacementAt(doc, config, { x: 3, y: 2.5 }).valid,
    false,
  );
  const result = architecturePlacementAt(doc, config, { x: 3, y: 0.15 });
  assert.equal(result.valid, true, result.message);
  assert.equal(result.item.y, 0);
  const next = commitArchitecturePlacement(result).document;
  assert.match(
    architecturePlacementAt(next, config, { x: 3, y: 0 }).message,
    /重叠/,
  );
  for (const change of [
    { edit_locked: true },
    { load_bearing: true },
    { height: 0.8 },
    { boundary_type: "glass_railing" },
  ]) {
    const next = fixture();
    Object.assign(next.layout.walls[0], change);
    assert.equal(
      architecturePlacementAt(next, config, { x: 3, y: 0 }).valid,
      false,
    );
  }
  assert.equal(doc.layout.openings.length, 0);
});
test("新增墙段保护边界、长度、几何重叠和数量，不能写入 NaN", () => {
  for (const length of ["", NaN, Infinity, 0.01, 31])
    assert.equal(
      architecturePlacementAt(
        fixture(),
        { preset_id: "wall", length },
        { x: 3, y: 2 },
      ).valid,
      false,
    );
  assert.equal(
    architecturePlacementAt(fixture(), { preset_id: "wall" }, { x: 60, y: 2 })
      .valid,
    false,
  );
  assert.equal(
    architecturePlacementAt(fixture(), { preset_id: "wall" }, { x: 3, y: 0 })
      .valid,
    false,
  );
  const result = architecturePlacementAt(
    fixture(),
    { preset_id: "wall", height: NaN },
    { x: 3, y: 2 },
  );
  assert.equal(result.valid, false);
  assert.equal(result.item, null);
});
test("三维选墙按射线命中可见墙面，忽略隐藏墙及剖切掉的上半墙", () => {
  const walls = fixture().layout.walls,
    origin = { x: 0, y: 0 };
  const ray = new THREE.Ray(
    new THREE.Vector3(3, 1, 2),
    new THREE.Vector3(0, 0, -1),
  );
  const hit = architecturePointOnRay(ray, origin, walls, true);
  assert.equal(hit.wallId, "w0");
  assert.equal(hit.x, 3);
  assert.equal(hit.y, 0);
  ray.origin.y = 2;
  assert.equal(architecturePointOnRay(ray, origin, walls, true), null);
  assert.equal(architecturePointOnRay(ray, origin, walls, false).wallId, "w0");
  walls[0].edit_hidden = true;
  assert.equal(architecturePointOnRay(ray, origin, walls, false), null);
});
