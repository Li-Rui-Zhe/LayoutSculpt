import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  standPoints,
  insideRoom,
  roomClearance,
  connectPortals,
} from "../src/viewer/tourGeometry.js";
import { buildTour } from "../src/viewer/tourModel.js";
import { RoomTour } from "../src/viewer/RoomTour.js";

test("漫游拖动与方向键都朝输入方向转头，站位保持不变", () => {
  for (const [dx, dy, key, axis, sign] of [
    [30, 0, "ArrowRight", "x", 1],
    [-30, 0, "ArrowLeft", "x", -1],
    [0, -30, "ArrowUp", "y", 1],
    [0, 30, "ArrowDown", "y", -1],
  ]) {
    for (const input of ["drag", "key"]) {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(3, 1.55, 4);
      const tour = new RoomTour({ camera });
      tour.yaw = 0;
      tour.pitch = 0;
      if (input === "drag") tour.turnFromDrag(dx, dy);
      else assert.equal(tour.turnFromKey(key), true);
      const direction = camera.getWorldDirection(new THREE.Vector3());
      assert.ok(
        direction[axis] * sign > 0,
        `${input} ${key} 实际相机朝向应一致`,
      );
      assert.deepEqual(camera.position.toArray(), [3, 1.55, 4]);
    }
  }
});

test("环顾限制仰俯角，防止拖动过头造成上下倒置", () => {
  const camera = new THREE.PerspectiveCamera();
  const tour = new RoomTour({ camera });
  tour.yaw = 0;
  tour.pitch = 0;
  tour.turnFromDrag(0, -10000);
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).y > 0);
  assert.equal(tour.pitch, 1.05);
  tour.turnFromDrag(0, 20000);
  assert.equal(tour.pitch, -1.05);
  assert.equal(tour.turnFromKey("Escape"), false);
});

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
test("凹形房间站位必须在轮廓内且距离墙体足够远", () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 6 },
    { x: 0, y: 6 },
  ];
  const points = standPoints(polygon);
  assert.ok(points.length > 0);
  for (const p of points) {
    assert.ok(insideRoom(p, polygon));
    assert.ok(roomClearance(p, polygon) >= 0.28);
  }
});
test("家具占位被排除，不能为满屋家具强行找一个站位", () => {
  const polygon = rect(0, 0, 4, 4);
  assert.deepEqual(
    standPoints(polygon, [{ minX: 0, maxX: 4, minY: 0, maxY: 4 }]),
    [],
  );
  const points = standPoints(polygon, [{ minX: 0, maxX: 3, minY: 0, maxY: 4 }]);
  assert.ok(points.length);
  assert.ok(points.every((p) => p.x >= 3.28));
});
test("狭窄或无效房间不提供不安全站位", () => {
  assert.deepEqual(standPoints(rect(0, 0, 0.4, 4)), []);
  assert.deepEqual(standPoints([]), []);
});
test("大房间候选点数量有上限，站位之间保留距离", () => {
  const points = standPoints(rect(0, 0, 100, 100));
  assert.equal(points.length, 3);
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      assert.ok(
        Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) > 2.2,
      );
});
const rooms = [
  { id: "a", polygon: rect(0, 0, 4, 4) },
  { id: "b", polygon: rect(4.2, 0, 4, 4) },
];
test("真实门和通道双向连接；窗户、外门和失效门洞不产生虚构连接", () => {
  const opening = { id: "door", x: 4.1, y: 2, normal: [1, 0], kind: "door" };
  assert.deepEqual(connectPortals(rooms, [opening])[0].rooms, ["a", "b"]);
  assert.equal(
    connectPortals(rooms, [{ ...opening, kind: "passage" }]).length,
    1,
  );
  assert.equal(
    connectPortals(rooms, [{ ...opening, kind: "window" }]).length,
    0,
  );
  assert.equal(connectPortals(rooms, [{ ...opening, x: 0 }]).length, 0);
  assert.equal(
    connectPortals(rooms, [{ ...opening, normal: [0, 0] }]).length,
    0,
  );
});
test("重叠或模糊的房间关系不猜测门户", () => {
  assert.equal(
    connectPortals(
      [...rooms, { id: "duplicate", polygon: rooms[0].polygon }],
      [{ id: "x", kind: "door", x: 4.1, y: 2, normal: [1, 0] }],
    ).length,
    0,
  );
});
function floor(id, x) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.04, 4),
    new THREE.MeshStandardMaterial(),
  );
  mesh.position.set(x, 0.02, 0);
  mesh.userData = { structure_kind: "room", room_id: id, room_name: id };
  return mesh;
}
test("模型世界变换、床体遮挡和门窗元数据共同参与导航", () => {
  const root = new THREE.Group();
  root.position.set(10, 0, -5);
  root.add(floor("a", 0), floor("b", 4.2));
  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(2, 1, 3),
    new THREE.MeshStandardMaterial(),
  );
  bed.position.y = 0.5;
  bed.userData.furniture_index = 0;
  root.add(bed);
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 2, 1),
    new THREE.MeshStandardMaterial(),
  );
  frame.position.set(2.1, 1, 0);
  frame.name = "门套";
  frame.userData = {
    opening_kind: "door",
    opening_index: 0,
    wall_id: "w",
    wall_normal: [1, 0],
  };
  root.add(frame);
  const tour = buildTour(root);
  assert.equal(tour.available.length, 2);
  assert.equal(tour.portals.length, 1);
  assert.equal(tour.portals[0].x, 12.1);
  assert.equal(tour.portals[0].y, -5);
  assert.ok(
    tour.available[0].stations.every(
      (p) => p.x > 8 && p.x < 12 && p.y > -7 && p.y < -3,
    ),
  );
  assert.ok(
    tour.available[0].stations.every(
      (p) => Math.abs(p.x - 10) > 1.28 || Math.abs(p.y + 5) > 1.78,
    ),
  );
});
test("没有房间边界的导入模型可查看，但不冒充有漫游数据", () => {
  const model = new THREE.Group();
  model.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, 3),
      new THREE.MeshStandardMaterial(),
    ),
  );
  assert.deepEqual(buildTour(model).available, []);
});
test("开放式房间和无门框通道可连通，真实墙体和窗玻璃会阻止自动补点", () => {
  const root = new THREE.Group();
  root.add(floor("a", 0), floor("b", 4.2));
  assert.equal(buildTour(root).portals.length, 1);
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 2.6, 4),
    new THREE.MeshStandardMaterial(),
  );
  wall.position.set(2.1, 1.3, 0);
  wall.userData = { furniture_index: 0, asset_id: "cabinet" };
  root.add(wall);
  assert.equal(buildTour(root).portals.length, 1);
  wall.userData = {};
  wall.userData.wall_id = "w";
  root.add(wall);
  assert.equal(buildTour(root).portals.length, 0);
  wall.material.transparent = true;
  wall.material.opacity = 0.1;
  wall.userData.opening_kind = "window";
  assert.equal(buildTour(root).portals.length, 0);
});
