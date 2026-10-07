import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { installCutaway, updateCutaway } from "../src/viewer/cutaway.js";

test("完整墙体与封口剖切预览互斥显示，重复安装不会增加几何", () => {
  const model = new THREE.Group();
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(2, 3, 0.2),
    new THREE.MeshStandardMaterial(),
  );
  const preview = new THREE.BoxGeometry(2, 1.2, 0.2);
  wall.userData = {
    cutaway_full: true,
    cutaway_geometry: {
      positions: Array.from(preview.attributes.position.array),
      indices: Array.from(preview.index.array),
    },
  };
  model.add(wall);
  installCutaway(model);
  installCutaway(model);
  assert.equal(model.children.length, 2);
  const cut = model.children[1];
  updateCutaway(model, new THREE.PerspectiveCamera());
  assert.equal(wall.visible, false);
  assert.equal(cut.visible, true);
  updateCutaway(model, new THREE.PerspectiveCamera(), { enabled: false });
  assert.equal(wall.visible, true);
  assert.equal(cut.visible, false);
  assert.equal(cut.material, wall.material);
});

test("水平剖切随旋转保持连续，完整模式恢复所有墙体，低墙不会消失", () => {
  const model = new THREE.Group(),
    camera = new THREE.PerspectiveCamera();
  const parts = [
    { cutaway_upper: false },
    { cutaway_upper: true, wall_exterior: true, wall_normal: [0, 1] },
    { cutaway_upper: true, wall_exterior: true, wall_normal: [0, -1] },
    { cutaway_upper: true, wall_exterior: false },
  ].map((data) => {
    const obj = new THREE.Object3D();
    obj.userData = data;
    model.add(obj);
    return obj;
  });
  camera.position.set(0, 8, 10);
  updateCutaway(model, camera);
  assert.deepEqual(
    parts.map((o) => o.visible),
    [true, false, false, false],
  );
  camera.position.z = -10;
  updateCutaway(model, camera);
  assert.deepEqual(
    parts.map((o) => o.visible),
    [true, false, false, false],
  );
  updateCutaway(model, camera, { top: true });
  assert.deepEqual(
    parts.map((o) => o.visible),
    [true, false, false, false],
  );
  updateCutaway(model, camera, { enabled: false });
  assert.ok(parts.every((o) => o.visible));
});
