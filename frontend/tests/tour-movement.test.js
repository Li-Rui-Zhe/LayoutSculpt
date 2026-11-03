import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { movementDelta, moveOnFloor } from "../src/viewer/tourMovement.js";
import { buildWalkObstacles } from "../src/viewer/tourWalking.js";
import { RoomTour } from "../src/viewer/RoomTour.js";

const polygon = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 8 },
  { x: 0, y: 8 },
];
const direction = (...values) => new Set(values);
function setup() {
  const events = [];
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(4, 1.55, 4);
  const tour = new RoomTour({
    camera,
    model: new THREE.Group(),
    callbacks: { onTour: (value) => events.push(value) },
  });
  tour.active = true;
  tour.yaw = 0;
  tour.pitch = 0.6;
  tour.room = { id: "a", floor: 0, polygon };
  tour.data = { rooms: [tour.room], portals: [] };
  tour.walkCollision = new Map([["a", []]]);
  tour.hotspots = [];
  tour.renderHotspots = () => {};
  return { tour, camera, events };
}
test("移动随当前朝向，前后左右相反，斜向保持同一速度", () => {
  const forward = movementDelta(direction("forward"), 0, 1);
  assert.equal(forward.x, 0);
  assert.equal(forward.y, -1);
  assert.equal(movementDelta(direction("right"), 0, 1).x, 1);
  assert.equal(movementDelta(direction("left"), 0, 1).x, -1);
  assert.equal(movementDelta(direction("backward"), 0, 1).y, 1);
  const turned = movementDelta(direction("forward"), Math.PI / 2, 1);
  assert.ok(Math.abs(turned.x - 1) < 1e-8 && Math.abs(turned.y) < 1e-8);
  const diagonal = movementDelta(direction("forward", "right"), 0.6, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-8);
  assert.deepEqual(movementDelta(direction("forward", "backward"), 1, 1), {
    x: 0,
    y: 0,
  });
});
test("键盘与按钮连续移动不会穿薄墙，斜行贴墙时沿墙移动", () => {
  const model = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.005, 3, 8));
  wall.position.set(4, 1.5, 4);
  wall.userData.wall_id = "wall";
  model.add(wall);
  const obstacles = buildWalkObstacles(model, 0);
  const from = { x: 3.7, y: 3 };
  assert.deepEqual(
    moveOnFloor(from, { x: 2, y: 0 }, [[polygon]], obstacles),
    from,
  );
  assert.deepEqual(
    moveOnFloor(from, { x: 0.2, y: 0.2 }, [[polygon]], obstacles),
    { x: 3.7, y: 3.2 },
  );
  assert.deepEqual(
    moveOnFloor({ x: 0.3, y: 2 }, { x: -1, y: 0 }, [[polygon]], []),
    { x: 0.3, y: 2 },
  );
  const hole = [
    { x: 3, y: 3 },
    { x: 5, y: 3 },
    { x: 5, y: 5 },
    { x: 3, y: 5 },
  ];
  assert.deepEqual(
    moveOnFloor({ x: 2, y: 4 }, { x: 4, y: 0 }, [[polygon, hole]], []),
    { x: 2, y: 4 },
  );
});
test("按住连续走、重复按键不重复发布，松开及失焦清理后立即停住", () => {
  const { tour, camera, events } = setup();
  tour.setMoveInput("key:KeyW", "forward", true);
  const before = events.length;
  tour.setMoveInput("key:KeyW", "forward", true);
  assert.equal(events.length, before);
  const start = tour.manualTime;
  for (let i = 1; i <= 10; i++) tour.update(start + i * 20);
  assert.ok(Math.abs(camera.position.z - 3.7) < 1e-6);
  assert.equal(camera.position.y, 1.55);
  assert.equal(events.at(-1).manual, true);
  tour.setMoveInput("key:KeyW", "forward", false);
  const stopped = camera.position.clone();
  tour.update(start + 1000);
  assert.ok(camera.position.equals(stopped));
  assert.equal(events.at(-1).moving, false);
  tour.setMoveInput("pad:right", "right", true);
  tour.update(tour.manualTime + 50);
  assert.ok(camera.position.x > stopped.x);
  tour.clearMoveInputs();
  const blurred = camera.position.clone();
  tour.update(start + 3000);
  assert.ok(camera.position.equals(blurred));
});
test("掉帧不会大步瞬移，手动移动接管点击路线，按钮小步可被读屏调用", () => {
  const { tour, camera } = setup();
  tour.walking = { fake: true };
  tour.setMoveInput("key:KeyW", "forward", true);
  assert.equal(tour.walking, null);
  tour.update(tour.manualTime + 60000);
  assert.ok(Math.abs(camera.position.z - 3.925) < 1e-6);
  tour.fastMove = true;
  const z = camera.position.z;
  tour.update(tour.manualTime + 50);
  assert.ok(Math.abs(z - camera.position.z - 0.14) < 1e-6);
  tour.stepMove("left");
  assert.ok(Math.abs(camera.position.x - 3.7) < 1e-6);
  assert.equal(tour.moveInputs.size, 0);
});
test("短于一帧的按钮轻点也能移动，重复释放不多走，失焦不补步", () => {
  const { tour, camera } = setup();
  tour.setMoveInput("pad:forward", "forward", true);
  tour.setMoveInput("pad:forward", "forward", false);
  assert.ok(Math.abs(camera.position.z - 3.88) < 1e-6);
  const position = camera.position.clone();
  tour.setMoveInput("pad:forward", "forward", false);
  assert.ok(camera.position.equals(position));
  tour.setMoveInput("key:KeyW", "forward", true);
  tour.clearMoveInputs();
  assert.ok(camera.position.equals(position));
});
test("连续跨开放分区更新当前房间，撞墙提示不逐帧重复", () => {
  const { tour, camera, events } = setup();
  const a = {
    id: "a",
    floor: 0,
    polygon: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 8 },
      { x: 0, y: 8 },
    ],
  };
  const b = {
    ...a,
    id: "b",
    polygon: a.polygon.map((p) => ({ ...p, x: p.x + 4 })),
  };
  tour.room = a;
  tour.data = { rooms: [a, b], portals: [{ rooms: ["a", "b"] }] };
  camera.position.x = 3.99;
  tour.setMoveInput("pad:right", "right", true);
  tour.update(tour.manualTime + 50);
  assert.equal(tour.room.id, "b");
  assert.equal(events.at(-1).room, "b");
  camera.position.x = 7.76;
  for (let i = 0; i < 10; i++) tour.update(tour.manualTime + 50);
  assert.equal(
    events.filter((event) => event.message.includes("不可通行")).length,
    1,
  );
  assert.equal(camera.position.x, 7.76);
});
