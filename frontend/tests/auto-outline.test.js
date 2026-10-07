import test from "node:test";
import assert from "node:assert/strict";
import { deriveOutline, fitOutline } from "../src/editor/autoOutline.js";
import {
  clone,
  contains,
  polygonArea,
  polygonInside,
  moveWall,
} from "../src/editor/geometry.js";

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const room = (id, polygon) => ({ id, name: id, polygon, floor_enabled: true });
const wall = (id, start, end) => ({
  id,
  start,
  end,
  thickness: 0.2,
  exterior: true,
});
const doc = () => ({
  layout: {
    outline: rect(0, 0, 4, 4),
    rooms: [room("main", rect(0, 0, 4, 4))],
    walls: [],
    lights: [],
  },
  furniture: { items: [{ x: 2, y: 2 }] },
});

test("自动轮廓扩展与收缩保留凹角，不变成矩形包围盒", () => {
  const original = doc(),
    next = clone(original);
  next.layout.rooms.push(room("balcony", rect(4, 1, 2, 2)));
  const fitted = fitOutline(original, next);
  assert.equal(polygonArea(fitted.layout.outline), 20);
  assert.ok(contains({ x: 5, y: 2 }, fitted.layout.outline));
  assert.ok(!contains({ x: 5, y: 0.5 }, fitted.layout.outline));
  const smaller = clone(fitted);
  smaller.layout.rooms.pop();
  assert.equal(polygonArea(fitOutline(fitted, smaller).layout.outline), 16);
  assert.deepEqual(original, doc());
});

test("墙体联动后的轮廓涵盖实际墙厚，斜墙保留真实方向", () => {
  const original = doc();
  original.layout.walls = [wall("top", { x: 0, y: 0 }, { x: 4, y: 0 })];
  const fitted = fitOutline(original, moveWall(original, 0, 0, -0.4));
  assert.ok(contains({ x: 2, y: -0.5 }, fitted.layout.outline));
  assert.ok(
    polygonInside(fitted.layout.rooms[0].polygon, fitted.layout.outline),
  );
  const diagonal = deriveOutline({
    ...original.layout,
    rooms: [],
    walls: [wall("diagonal", { x: 0, y: 0 }, { x: 20, y: 20 })],
  });
  assert.ok(diagonal.outline);
  assert.ok(contains({ x: 10, y: 10.1 }, diagonal.outline));
  assert.ok(!contains({ x: 0, y: 20 }, diagonal.outline));
});

test("家具越界、灯光、地板开关与材质修改不扩大或重写原轮廓", () => {
  const original = doc(),
    next = clone(original);
  next.furniture.items[0].x = 40;
  next.layout.lights.push({ x: 45, y: 45 });
  next.layout.rooms[0].floor_enabled = false;
  next.layout.rooms[0].floor_finish = "oak";
  assert.deepEqual(
    fitOutline(original, next).layout.outline,
    original.layout.outline,
  );
  assert.equal(polygonArea(deriveOutline(next.layout).outline), 16);
});

test("脱离主体的空间与墙体被定位，不自动桥接或丢弃", () => {
  const original = doc(),
    next = clone(original);
  next.layout.rooms.push(room("detached", rect(10, 0, 1, 1)));
  assert.match(deriveOutline(next.layout).issue.text, /detached.*脱离/);
  assert.deepEqual(
    fitOutline(original, next).layout.outline,
    original.layout.outline,
  );
  next.layout.rooms.pop();
  next.layout.walls.push(wall("detached", { x: 10, y: 0 }, { x: 10, y: 2 }));
  assert.deepEqual(deriveOutline(next.layout).issue.type, "walls");
});

test("闭合墙网内部的独立地板可用，自交空间不能自动修复", () => {
  const layout = doc().layout;
  layout.rooms = [room("island", rect(1, 1, 2, 2))];
  layout.walls = rect(0, 0, 4, 4).map((p, i, points) =>
    wall(String(i), p, points[(i + 1) % points.length]),
  );
  const fitted = deriveOutline(layout);
  assert.ok(fitted.outline);
  assert.ok(polygonInside(layout.rooms[0].polygon, fitted.outline));
  layout.rooms[0].polygon = [
    { x: 1, y: 1 },
    { x: 3, y: 3 },
    { x: 1, y: 3 },
    { x: 3, y: 1 },
  ];
  assert.equal(deriveOutline(layout).issue.type, "rooms");
});

test("自动轮廓保留超过40个真实拐点，清空结构保留现有空基座", () => {
  const layout = doc().layout;
  layout.rooms = Array.from({ length: 24 }, (_, i) =>
    room(String(i), rect(i, 0, 1, i % 2 ? 2 : 3)),
  );
  const result = deriveOutline(layout);
  assert.ok(result.outline.length > 40);
  assert.ok(
    layout.rooms.every((r) => polygonInside(r.polygon, result.outline)),
  );
  layout.rooms = [];
  assert.deepEqual(deriveOutline(layout).outline, layout.outline);
});
