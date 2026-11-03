import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { TourFurniture } from "../src/viewer/TourFurniture.js";
import { arrivalYaw, nearbyPortal } from "../src/viewer/tourPresentation.js";

function mesh(model, material, x, data) {
  const item = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), material);
  item.position.set(x, 1, -0.8);
  item.userData = data;
  model.add(item);
  return item;
}
function settle(view, camera, start = 0) {
  for (let i = 0; i < 60; i++) view.update(camera, start + i * 16);
}

test("近镜头家具渐隐，共享材质的其他家具与墙体保持原样，离开后恢复", () => {
  const model = new THREE.Group();
  const original = new THREE.MeshStandardMaterial({ opacity: 0.8 });
  const near = mesh(model, original, 0, { furniture_index: 0 });
  const far = mesh(model, original, 8, { furniture_index: 1 });
  const wall = mesh(model, original, 0, { wall_id: "wall" });
  const view = new TourFurniture(model);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1, 0);
  settle(view, camera);
  assert.notEqual(near.material, original);
  assert.ok(near.material.opacity < 0.3);
  assert.equal(view.ignoresHit(near), true);
  assert.equal(far.material, original);
  assert.equal(wall.material, original);
  assert.equal(original.opacity, 0.8);
  camera.position.set(0, 1, 5);
  settle(view, camera, 1000);
  assert.equal(near.material, original);
  assert.equal(view.ignoresHit(near), false);
  view.dispose();
});

test("材质数组独立淡化，退出销毁副本但不销毁原材质", () => {
  const model = new THREE.Group();
  const a = new THREE.MeshStandardMaterial();
  const b = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 });
  const materials = [a, b];
  const fixture = mesh(model, materials, 0, { fixture_id: "lamp" });
  const view = new TourFurniture(model);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1, -0.8);
  settle(view, camera);
  assert.equal(fixture.material.length, 2);
  assert.ok(
    Math.abs(fixture.material[1].opacity / fixture.material[0].opacity - 0.5) <
      0.001,
  );
  let copiesDisposed = 0,
    originalsDisposed = 0;
  fixture.material.forEach((m) =>
    m.addEventListener("dispose", () => copiesDisposed++),
  );
  materials.forEach((m) =>
    m.addEventListener("dispose", () => originalsDisposed++),
  );
  view.dispose();
  assert.equal(fixture.material, materials);
  assert.equal(copiesDisposed, 2);
  assert.equal(originalsDisposed, 0);
});

test("建筑构件和隐藏家具不参与淡化，外部替换材质不会被退出覆盖", () => {
  const model = new THREE.Group();
  const original = new THREE.MeshStandardMaterial();
  const furniture = mesh(model, original, 0, { furniture_index: 1 });
  const architecture = mesh(model, original, 0, {
    furniture_index: 2,
    architecture_network: true,
  });
  const hidden = mesh(model, original, 0, { furniture_index: 3 });
  hidden.visible = false;
  const view = new TourFurniture(model);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1, 0);
  settle(view, camera);
  assert.equal(architecture.material, original);
  assert.equal(hidden.material, original);
  const replacement = new THREE.MeshStandardMaterial();
  furniture.material = replacement;
  view.dispose();
  assert.equal(furniture.material, replacement);
});

const square = (id, name, y = 0) => ({
  id,
  name,
  polygon: [
    { x: -3, y: y - 2 },
    { x: 3, y: y - 2 },
    { x: 3, y: y + 2 },
    { x: -3, y: y + 2 },
  ],
  stations: [{ x: 0, y }],
});

test("露台进入后看向相邻客厅", () => {
  const terrace = square("terrace", "花园露台", 4);
  const living = square("living", "客厅");
  const yaw = arrivalYaw(
    terrace,
    { x: 0, y: 4 },
    {
      rooms: [terrace, living],
      portals: [{ rooms: ["terrace", "living"] }],
    },
  );
  assert.equal(yaw, 0);
});

test("靠近房间边缘时朝室内，中心和凹房间仍有有限朝向", () => {
  const room = square("r", "卧室");
  const data = { rooms: [room], portals: [] };
  const yaw = arrivalYaw(room, { x: 2.8, y: 0 }, data, [{ x: -1, y: 0 }]);
  assert.ok(Math.sin(yaw) < -0.7);
  assert.ok(Number.isFinite(arrivalYaw(room, { x: 0, y: 0 }, data)));
  room.polygon = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 5 },
    { x: 0, y: 5 },
  ];
  assert.ok(Number.isFinite(arrivalYaw(room, { x: 0.5, y: 3 }, data)));
});

test("门口提示只在靠近时出现，距离边界有滞回避免闪烁", () => {
  assert.equal(nearbyPortal(3), false);
  assert.equal(nearbyPortal(2.3), true);
  assert.equal(nearbyPortal(2.6), false);
  assert.equal(nearbyPortal(2.6, true), true);
  assert.equal(nearbyPortal(2.9, true), false);
  assert.equal(nearbyPortal(0.1, true), false);
});
