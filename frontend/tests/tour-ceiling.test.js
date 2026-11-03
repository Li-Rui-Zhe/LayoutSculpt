import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TourCeiling } from "../src/viewer/TourCeiling.js";

function fixture() {
  const model = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.1, 4),
    new THREE.MeshStandardMaterial(),
  );
  floor.userData = {
    structure_kind: "room",
    room_id: "living",
    room_name: "客厅",
  };
  model.add(floor);
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(4, 2.8, 0.2),
    new THREE.MeshStandardMaterial(),
  );
  wall.position.set(0, 1.4, -2);
  wall.userData.wall_id = "north";
  model.add(wall);
  return { model, floor, wall };
}
function hit(root, x, z) {
  root.updateMatrixWorld(true);
  return new THREE.Raycaster(
    new THREE.Vector3(x, 1.55, z),
    new THREE.Vector3(0, 1, 0),
  ).intersectObject(root, true);
}

test("室内顶面遮住向上的窗景，按实际墙高生成，不改原模型", () => {
  const { model, floor } = fixture();
  const geometry = floor.geometry,
    material = floor.material;
  const scene = new THREE.Scene();
  scene.add(model);
  const ceiling = new TourCeiling(scene, model);
  const hits = hit(ceiling.root, 0, 0);
  assert.ok(hits.length);
  assert.ok(Math.abs(hits[0].point.y - 2.795) < 0.001);
  assert.equal(hit(ceiling.root, 4, 4).length, 0);
  assert.equal(model.children.length, 2);
  assert.equal(floor.geometry, geometry);
  assert.equal(floor.material, material);
  assert.equal(ceiling.root.children[0].castShadow, false);
  let released = 0;
  ceiling.root.children[0].geometry.addEventListener(
    "dispose",
    () => released++,
  );
  ceiling.material.addEventListener("dispose", () => released++);
  ceiling.dispose();
  assert.equal(released, 2);
  assert.deepEqual(scene.children, [model]);
});

test("阳台、露台、庭院与明确室外标记保持敞开；没有墙高不猜顶面", () => {
  for (const name of ["阳台", "露台", "庭院", "花园", "balcony"]) {
    const { model, floor } = fixture();
    floor.userData.room_name = name;
    const ceiling = new TourCeiling(new THREE.Scene(), model);
    assert.equal(ceiling.root.children.length, 0, name);
    ceiling.dispose();
  }
  const { model, floor, wall } = fixture();
  floor.userData.outdoor = true;
  let ceiling = new TourCeiling(new THREE.Scene(), model);
  assert.equal(ceiling.root.children.length, 0);
  ceiling.dispose();
  delete floor.userData.outdoor;
  wall.removeFromParent();
  ceiling = new TourCeiling(new THREE.Scene(), model);
  assert.equal(ceiling.root.children.length, 0);
  ceiling.dispose();
});

test("顶面使用地面原三角形，保留中庭孔洞及模型坐标变换", () => {
  const { model, floor } = fixture();
  const shape = new THREE.Shape();
  shape.moveTo(-2, -2);
  shape.lineTo(2, -2);
  shape.lineTo(2, 2);
  shape.lineTo(-2, 2);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.5, -0.5);
  hole.lineTo(-0.5, 0.5);
  hole.lineTo(0.5, 0.5);
  hole.lineTo(0.5, -0.5);
  hole.closePath();
  shape.holes.push(hole);
  floor.geometry = new THREE.ShapeGeometry(shape);
  floor.rotation.x = -Math.PI / 2;
  model.position.set(10, 0, 7);
  model.scale.setScalar(1.2);
  const ceiling = new TourCeiling(new THREE.Scene(), model);
  assert.equal(hit(ceiling.root, 10, 7).length, 0);
  const hits = hit(ceiling.root, 11.8, 7);
  assert.ok(hits.length);
  assert.ok(Math.abs(hits[0].point.y - (2.8 * 1.2 - 0.005)) < 0.001);
  ceiling.dispose();
});

test("真实示例只补六个室内区域，露台无遮挡，房间与家具数据保持原样", async () => {
  const bytes = await readFile(
    new URL("../../public/models/forest-home-v3.glb", import.meta.url),
  );
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: "geometry-only",
    loadTexture: () => Promise.resolve(null),
  }));
  const { scene: model } = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  const original = new Map();
  model.traverse((o) =>
    original.set(o, {
      geometry: o.geometry,
      material: o.material,
      visible: o.visible,
    }),
  );
  const ceiling = new TourCeiling(new THREE.Scene(), model);
  assert.equal(ceiling.root.children.length, 6);
  assert.ok(
    ceiling.root.children.every((o) => o.userData.room_id !== "terrace"),
  );
  assert.equal(hit(ceiling.root, -2, 4).length, 0);
  assert.ok(hit(ceiling.root, -2, 0).length);
  model.traverse((o) =>
    assert.deepEqual(
      { geometry: o.geometry, material: o.material, visible: o.visible },
      original.get(o),
    ),
  );
  ceiling.dispose();
});
