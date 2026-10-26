import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  floorBoundary,
  setRoomIsolation,
} from "../src/viewer/roomIsolation.js";
import { transformPartGroup } from "../src/diy/partGroups.js";
import { furnitureTemplate } from "../src/diy/templates.js";
import { nextWallFinish } from "../src/editor/designTools.js";
import { mergeDraft } from "../src/hooks/mergeDraft.js";
import { createDraftSession } from "../src/hooks/draftSession.js";
import { prepareIsolationMaterials } from "../src/viewer/roomIsolation.js";
import { readContext, writeContext } from "../src/hooks/urlContext.js";

test("房间隔离保留凹多边形边界并可还原，共享材质只安装一次", () => {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (const [x, y] of [
    [3, 0],
    [3, 1],
    [1, 1],
    [1, 3],
    [0, 3],
  ])
    shape.lineTo(x, y);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.userData = { structure_kind: "room", room_id: "r" };
  const model = new THREE.Group();
  model.add(mesh);
  const scene = { model };
  const polygon = floorBoundary(mesh);
  assert.equal(polygon.length, 6);
  const area = Math.abs(
    polygon.reduce(
      (sum, p, i) =>
        sum +
        p.x * polygon[(i + 1) % polygon.length].y -
        p.y * polygon[(i + 1) % polygon.length].x,
      0,
    ) / 2,
  );
  assert.ok(Math.abs(area - 5) < 1e-5);
  assert.equal(setRoomIsolation(scene, "r"), true);
  const hook = mesh.material.onBeforeCompile;
  assert.equal(model.userData.roomIsolation.enabled.value, 1);
  setRoomIsolation(scene, "r");
  assert.equal(mesh.material.onBeforeCompile, hook);
  setRoomIsolation(scene, null);
  assert.equal(model.userData.roomIsolation.enabled.value, 0);
  assert.equal(setRoomIsolation(scene, "missing"), false);
});

test("部件层级变换包含子组，锁定拒绝整组操作且不修改原设计", () => {
  const d = furnitureTemplate("chair");
  d.parts[0].edit_group = "椅子/软包";
  d.parts[1].edit_group = "椅子/软包/靠背";
  const moved = transformPartGroup(d, "椅子/软包", "move", { x: 0.1 });
  assert.equal(moved.parts[0].x, d.parts[0].x + 0.1);
  assert.equal(moved.parts[1].x, d.parts[1].x + 0.1);
  assert.deepEqual(moved.parts[2], d.parts[2]);
  d.parts[1].edit_locked = true;
  assert.throws(() => transformPartGroup(d, "椅子", "rotate", 15), /锁定/);
});

test("连续添加局部墙面寻找不重叠空位", () => {
  const wall = {
    start: { x: 0, y: 0 },
    end: { x: 2.5, y: 0 },
    height: 2.8,
    finish_regions: [],
  };
  const first = nextWallFinish(wall);
  wall.finish_regions.push(first);
  const second = nextWallFinish(wall);
  assert.ok(
    second.offset >= first.offset + first.width ||
      second.side !== first.side ||
      second.bottom >= first.bottom + first.height,
  );
});

test("三方合并独立对象修改，拒绝同字段与删除编辑冲突", () => {
  const base = {
      items: [
        { id: "a", x: 1 },
        { id: "b", x: 1 },
      ],
    },
    local = structuredClone(base),
    remote = structuredClone(base);
  local.items[0].x = 2;
  remote.items[1].x = 3;
  assert.deepEqual(mergeDraft(base, local, remote), {
    document: {
      items: [
        { id: "a", x: 2 },
        { id: "b", x: 3 },
      ],
    },
    conflicts: [],
  });
  remote.items[0].x = 4;
  assert.equal(mergeDraft(base, local, remote).conflicts.length, 1);
  remote.items = remote.items.filter((p) => p.id !== "a");
  assert.equal(mergeDraft(base, local, remote).conflicts.length, 1);
});

test("草稿修订冲突读取远端并重新保存合并结果", async () => {
  let server = { revision: 1, document: { x: 1, y: 1 } },
    last;
  const write = async (key, body) => {
    if (body.revision !== server.revision) {
      const e = Error("冲突");
      e.status = 409;
      throw e;
    }
    server = { revision: server.revision + 1, document: body.document };
    return { ...server, updated_at: new Date().toISOString() };
  };
  const session = createDraftSession(
    "a",
    1,
    write,
    (v) => {
      if (v.document) last = v.document;
    },
    10000,
    { read: async () => server },
  );
  session.schedule({ x: 1, y: 1 });
  await session.flush();
  server = { revision: 3, document: { x: 1, y: 3 } };
  session.schedule({ x: 2, y: 1 });
  await session.flush();
  assert.deepEqual(server.document, { x: 2, y: 3 });
  assert.deepEqual(last, server.document);
});

test("隔离墙体保留墙厚余量，共享家具材质不会随之扩大裁切边界", () => {
  const m = new THREE.MeshStandardMaterial(),
    wall = new THREE.Mesh(new THREE.BoxGeometry(), m),
    chair = new THREE.Mesh(new THREE.BoxGeometry(), m);
  wall.userData.wall_id = "w";
  chair.userData.furniture_index = 0;
  const model = new THREE.Group();
  model.add(wall, chair);
  prepareIsolationMaterials(model);
  assert.notEqual(wall.material, chair.material);
  assert.equal(wall.material.userData.roomIsolationMargin, 0.35);
  assert.equal(chair.material.userData.roomIsolationMargin, undefined);
});

test("分组缩放包含子组、保持底面高度并拒绝非法尺寸", () => {
  const d = furnitureTemplate("chair");
  for (const p of d.parts) p.edit_group = "椅子 / 支撑";
  const before = Math.min(...d.parts.map((p) => p.z)),
    scaled = transformPartGroup(d, "椅子", "scale", 1.2);
  assert.equal(Math.min(...scaled.parts.map((p) => p.z)), before);
  assert.ok(Math.abs(scaled.parts[0].width - d.parts[0].width * 1.2) < 1e-8);
  assert.throws(
    () => transformPartGroup(d, "椅子", "scale", 100),
    /超|不能|范围/,
  );
});

test("页面地址状态保留中文筛选与页面，拒绝未知页签及项目标识", () => {
  const oldLocation = globalThis.location,
    oldHistory = globalThis.history;
  try {
    globalThis.location = {
      href: "http://127.0.0.1:5173/?tab=unknown&project=not-a-project#library",
    };
    globalThis.history = {
      replaceState: (_s, _t, url) => {
        location.href = String(url);
      },
    };
    assert.equal(readContext("tab", "design"), "design");
    assert.equal(readContext("project", "sample"), "sample");
    writeContext({ q: "餐椅", tab: "edit", project: "a".repeat(32) });
    assert.equal(readContext("q"), "餐椅");
    assert.equal(new URL(location.href).hash, "#library");
    writeContext({ q: null });
    assert.equal(readContext("q"), "");
  } finally {
    globalThis.location = oldLocation;
    globalThis.history = oldHistory;
  }
});
