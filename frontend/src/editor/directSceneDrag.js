import * as THREE from "three";
import { scenePose } from "./sceneEdits.js";
import { liveObjects, selectionFromHit } from "./liveModel.js";

// 在抓取点所在平面计算位移，保留抓取偏移，避免模型中心突然跳到鼠标下方。
export function createDirectDrag(document, selection, point, initialRay) {
  const item = liveObjects(document, selection.type)[selection.index];
  const pose = scenePose(document, selection);
  if (!pose || item?.edit_locked || item?.edit_hidden) return null;
  let normal = new THREE.Vector3(0, 1, 0);
  let maxBottom = Infinity;
  if (selection.type === "openings") {
    const wall = document.layout.walls.find((w) => w.id === item.wall_id);
    normal
      .set(-(wall.end.y - wall.start.y), 0, wall.end.x - wall.start.x)
      .normalize();
    maxBottom = Math.max(0, wall.height - item.height);
    if (initialRay && Math.abs(normal.dot(initialRay.direction)) < 0.1)
      normal.set(0, 1, 0);
  }
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
  return {
    transform(ray) {
      const hit = ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return null;
      const delta = hit.sub(point);
      return {
        ...pose,
        x: pose.x + delta.x,
        y: pose.y + delta.z,
        elevation: Math.min(
          maxBottom,
          Math.max(
            0,
            pose.elevation +
              (selection.type === "openings" && item.kind === "window"
                ? delta.y
                : 0),
          ),
        ),
        scale: { x: 1, y: 1, z: 1 },
      };
    },
  };
}

export function installDirectDrag({ element, rt, callbacks, pick, rayAt }) {
  let gesture = null;
  const stop = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const finish = (cancel = false) => {
    const previous = gesture;
    if (!previous) return;
    gesture = null;
    rt.directDragging = false;
    rt.controls.enabled = true;
    element.style.cursor = "";
    if (element.hasPointerCapture(previous.pointerId))
      element.releasePointerCapture(previous.pointerId);
    if (previous.started)
      callbacks.current.onSceneGesture?.(
        cancel ? "cancel" : "end",
        previous.transform,
      );
  };
  const down = (event) => {
    const cb = callbacks.current;
    if (
      gesture ||
      event.button !== 0 ||
      event.shiftKey ||
      event.altKey ||
      cb.transformMode !== "direct"
    )
      return;
    const hit = pick(event);
    if (!hit) return;
    const selection = selectionFromHit(
      hit.data,
      rt.modelDocument,
      cb.liveDocument,
    );
    if (!selection) return;
    // 地板覆盖大部分画布：先点选再拖，保留便捷的视角旋转区域。
    if (
      selection.type === "rooms" &&
      (cb.liveSelection?.type !== "rooms" ||
        cb.liveSelection.index !== selection.index)
    )
      return;
    const drag = createDirectDrag(
      cb.liveDocument,
      selection,
      hit.point,
      rayAt(event),
    );
    if (!drag) return;
    stop(event);
    gesture = {
      transformForRay: drag.transform,
      selection,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      started: false,
      editableAtStart: cb.liveEditable,
      transform: null,
    };
    rt.controls.enabled = false;
    element.setPointerCapture(event.pointerId);
    element.style.cursor = "grabbing";
    cb.onObjectSelect?.(hit.data, rt.modelDocument);
  };
  const move = (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    stop(event);
    // 精细模型同步期间保留点选，避免用户想拖家具却突然转动镜头。
    if (
      !gesture.started &&
      (!gesture.editableAtStart || !callbacks.current.liveEditable)
    )
      return;
    if (
      !gesture.started &&
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4
    )
      return;
    if (!gesture.started) {
      if (
        callbacks.current.onSceneGesture?.("start", null, gesture.selection) ===
        false
      ) {
        finish(true);
        return;
      }
      gesture.started = true;
      rt.directDragging = true;
    }
    const transform = gesture.transformForRay(rayAt(event));
    if (!transform) return;
    gesture.transform = transform;
    callbacks.current.onSceneGesture?.("preview", transform);
  };
  const up = (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    stop(event);
    finish(!gesture.transform);
  };
  const cancel = () => finish(true);
  const key = (event) => {
    if (event.key === "Escape" && gesture) {
      stop(event);
      cancel();
    }
  };
  element.addEventListener("pointerdown", down, true);
  element.addEventListener("pointermove", move, true);
  element.addEventListener("pointerup", up, true);
  element.addEventListener("pointercancel", cancel);
  element.addEventListener("lostpointercapture", cancel);
  window.addEventListener("blur", cancel);
  window.addEventListener("keydown", key, true);
  rt.cancelDirectDrag = cancel;
  return () => {
    cancel();
    element.removeEventListener("pointerdown", down, true);
    element.removeEventListener("pointermove", move, true);
    element.removeEventListener("pointerup", up, true);
    element.removeEventListener("pointercancel", cancel);
    element.removeEventListener("lostpointercapture", cancel);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("keydown", key, true);
  };
}
