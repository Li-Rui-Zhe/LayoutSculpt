import test from "node:test";
import assert from "node:assert/strict";
import { canSyncDoorPoses, doorPoseSnapshot } from "../src/editor/liveDoors.js";

function fixture() {
  return {
    layout: {
      walls: [
        { id: "w", start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, height: 2.7 },
      ],
      openings: [
        { kind: "door", wall_id: "w", offset: 1, width: 1, height: 2.1 },
      ],
      rooms: [],
      lights: [],
      outline: [],
    },
    furniture: { items: [] },
  };
}

test("门扇默认值、反向开启和撤销可本地处理，不改写模型快照", () => {
  const base = fixture(),
    before = structuredClone(base),
    next = structuredClone(base);
  Object.assign(next.layout.openings[0], {
    angle: 37,
    hinge: "end",
    swing: "right",
  });
  assert.equal(canSyncDoorPoses(base, next, [0]), true);
  assert.equal(canSyncDoorPoses(base, next, []), false);
  assert.equal(canSyncDoorPoses(base, before, [0]), true);
  assert.deepEqual(doorPoseSnapshot(base, next, [0]), next);
  assert.deepEqual(base, before);
});

test("修改洞口、移动墙体、更换款式、增删门及其他设计仍需建模", () => {
  for (const change of [
    (d) => d.layout.openings[0].width++,
    (d) => d.layout.openings[0].offset++,
    (d) => (d.layout.openings[0].door_style = "double"),
    (d) => (d.layout.openings[0].door_leaf = false),
    (d) => d.layout.walls[0].end.x++,
    (d) => d.layout.openings.push({ ...d.layout.openings[0] }),
    (d) => d.layout.openings.pop(),
    (d) => d.layout.lights.push({ id: "new" }),
  ]) {
    const base = fixture(),
      next = structuredClone(base);
    next.layout.openings[0].angle = 45;
    change(next);
    assert.equal(canSyncDoorPoses(base, next, [0]), false);
  }
});
