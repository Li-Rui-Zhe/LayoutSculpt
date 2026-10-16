import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { installFurniturePlacement } from "../src/editor/scenePlacement.js";

test("三维放置截获点击，只确认一次；拖出画布、取消和右键不添加", () => {
  const element = new EventTarget(),
    confirmed = [],
    moved = [];
  let captured = false,
    leaked = 0;
  element.setPointerCapture = () => {
    captured = true;
  };
  element.hasPointerCapture = () => captured;
  element.releasePointerCapture = () => {
    captured = false;
  };
  element.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
  });
  const callbacks = {
    current: {
      placement: {},
      onPlacementMove: (p) => moved.push(p),
      onPlacementConfirm: (p) => confirmed.push(p),
    },
  };
  const cleanup = installFurniturePlacement({
    element,
    callbacks,
    rt: { liveOrigin: { x: 10, y: 20 } },
    rayAt: (e) =>
      new THREE.Ray(
        new THREE.Vector3(e.clientX / 10, 5, 3),
        new THREE.Vector3(0, -1, 0),
      ),
  });
  element.addEventListener("pointerdown", () => leaked++);
  const send = (type, x = 20, extra = {}) => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, {
      pointerId: 1,
      clientX: x,
      clientY: 20,
      button: 0,
      buttons: 0,
      ...extra,
    });
    element.dispatchEvent(e);
  };
  send("pointermove");
  assert.deepEqual(moved.at(-1), { x: 12, y: 23 });
  send("pointerdown");
  send("pointerup");
  send("pointerup");
  assert.deepEqual(confirmed, [{ x: 12, y: 23 }]);
  assert.equal(leaked, 0);
  assert.equal(captured, false);
  send("pointerdown");
  send("pointerup", 40);
  send("pointerdown", 99);
  send("pointerup", 102);
  send("pointerdown");
  send("pointercancel");
  send("pointerup");
  send("pointerdown", 20, { button: 2 });
  send("pointerup", 20, { button: 2 });
  send("pointerdown");
  callbacks.current.placement = null;
  send("pointerup");
  assert.equal(confirmed.length, 1);
  assert.equal(captured, false);
  assert.equal(leaked, 1);
  cleanup();
});
