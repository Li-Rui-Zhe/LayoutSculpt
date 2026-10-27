import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { objectFocusBounds, focusCamera } from "../src/editor/objectFocus.js";

const document = {
  layout: {
    outline: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ],
    walls: [
      { id: "w", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, height: 2.8 },
    ],
    openings: [
      {
        edit_id: "window",
        wall_id: "w",
        offset: 2,
        width: 1.2,
        bottom: 0.9,
        height: 1.4,
      },
    ],
    rooms: [
      {
        id: "r",
        polygon: [
          { x: 1, y: 1 },
          { x: 4, y: 1 },
          { x: 4, y: 3 },
          { x: 1, y: 3 },
        ],
      },
    ],
    lights: [{ id: "l", x: 8, y: 5, elevation: 1.7 }],
  },
  furniture: {
    items: [
      {
        edit_id: "f",
        x: 3,
        y: 4,
        width: 2,
        depth: 1,
        height: 0.8,
        elevation: 0.2,
        rotation: 90,
      },
    ],
  },
};
test("定位所有设计对象，门窗按所在墙计算中心，保留设计数据", () => {
  const original = structuredClone(document);
  for (const type of [
    "walls",
    "openings",
    "rooms",
    "lights",
    "furniture",
    "outline",
  ]) {
    const box = objectFocusBounds(document, { type, index: 0 });
    assert.ok(box && !box.isEmpty());
  }
  const box = objectFocusBounds(document, { type: "openings", index: 0 });
  assert.ok(
    box
      .getCenter(new THREE.Vector3())
      .distanceTo(new THREE.Vector3(-2.4, 1.6, -4)) < 1e-8,
  );
  assert.deepEqual(document, original);
});
test("定位使用稳定身份和实际场景原点，不因对象重排或户型边界变化而跑偏", () => {
  const box = objectFocusBounds(
    document,
    { type: "openings", index: 999, id: "window" },
    { x: 0, y: 0 },
  );
  assert.ok(Math.abs(box.getCenter(new THREE.Vector3()).x - 2.6) < 1e-8);
  assert.equal(
    objectFocusBounds(document, { type: "openings", id: "deleted", index: 0 }),
    null,
  );
  assert.equal(objectFocusBounds(document, { type: "walls", index: 99 }), null);
});
test("三维定位实际移动相机和观察中心，重复点击仍有效且兼容减少动画", () => {
  const savedCancel = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  try {
    const camera = new THREE.PerspectiveCamera(38, 1.5, 0.01, 100);
    camera.position.set(10, 12, -15);
    const controls = new THREE.EventDispatcher();
    controls.target = new THREE.Vector3();
    controls.update = () => camera.lookAt(controls.target);
    const rt = { camera, controls, render: () => {} };
    const box = objectFocusBounds(document, { type: "openings", index: 0 });
    const initial = camera.position.clone();
    let cancel = focusCamera(rt, box, true);
    assert.ok(camera.position.distanceTo(initial) > 1);
    assert.ok(
      controls.target.distanceTo(box.getCenter(new THREE.Vector3())) < 1e-8,
    );
    const focused = camera.position.clone();
    cancel();
    camera.position.addScalar(5);
    cancel = focusCamera(rt, box, true);
    assert.ok(
      controls.target.distanceTo(box.getCenter(new THREE.Vector3())) < 1e-8,
    );
    assert.ok(camera.position.distanceTo(focused.clone().addScalar(5)) > 1);
    cancel();
  } finally {
    globalThis.cancelAnimationFrame = savedCancel;
  }
});
