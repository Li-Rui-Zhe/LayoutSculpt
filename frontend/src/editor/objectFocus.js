import * as THREE from "three";
import { liveObjects, planOrigin } from "./liveModel.js";
import { furnitureCorners, openingPoints } from "./geometry.js";

// 定位使用设计对象的边界，与 GLB 网格拆分、合并和剖切状态无关。
export function objectFocusBounds(document, selection, sceneOrigin) {
  if (!document || !selection) return null;
  const items = liveObjects(document, selection.type);
  const item =
    selection.type === "outline"
      ? { polygon: document.layout.outline }
      : selection.id
        ? items.find((value) => (value.edit_id || value.id) === selection.id)
        : items[selection.index];
  if (!item) return null;
  let points,
    bottom = 0,
    top = 0.1;
  if (selection.type === "furniture") {
    points = furnitureCorners(item);
    bottom = (item.elevation || 0) + 0.035;
    top = bottom + item.height;
  } else if (["rooms", "outline"].includes(selection.type)) {
    points = item.polygon;
    if (selection.type === "outline")
      top = Math.max(0.1, ...document.layout.walls.map((w) => w.height));
  } else if (selection.type === "walls") {
    points = [item.start, item.end];
    top = item.height;
  } else if (selection.type === "openings") {
    const wall = document.layout.walls.find(
      (value) => value.id === item.wall_id,
    );
    if (!wall) return null;
    points = openingPoints(item, wall);
    bottom = item.bottom;
    top = bottom + item.height;
  } else if (selection.type === "lights") {
    points = [item];
    bottom = item.elevation - 0.15;
    top = item.elevation + 0.15;
  } else return null;
  if (
    !points?.length ||
    ![bottom, top, ...points.flatMap((p) => [p.x, p.y])].every(Number.isFinite)
  )
    return null;
  const origin = sceneOrigin || planOrigin(document);
  const box = new THREE.Box3();
  for (const point of points)
    for (const height of [bottom, top])
      box.expandByPoint(
        new THREE.Vector3(point.x - origin.x, height, point.y - origin.y),
      );
  return box.expandByScalar(0.08);
}

export function focusCamera(rt, box, reducedMotion = false) {
  const target = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const direction = rt.camera.position
    .clone()
    .sub(rt.controls.target)
    .normalize();
  if (direction.lengthSq() < 0.01) direction.set(1, 0.8, -1).normalize();
  const distance =
    Math.max(2.8, size.length() * 1.7) /
    Math.min(1, Math.max(0.35, rt.camera.aspect));
  const position = target.clone().addScaledVector(direction, distance);
  const fromTarget = rt.controls.target.clone(),
    fromPosition = rt.camera.position.clone();
  let frame,
    stopped = false;
  const started = performance.now();
  const cancel = () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };
  const draw = () => {
    if (stopped) return;
    const t = reducedMotion
      ? 1
      : Math.min(1, (performance.now() - started) / 480);
    const ease = 1 - (1 - t) ** 3;
    rt.controls.target.lerpVectors(fromTarget, target, ease);
    rt.camera.position.lerpVectors(fromPosition, position, ease);
    rt.controls.update();
    rt.render();
    if (t < 1) frame = requestAnimationFrame(draw);
  };
  rt.controls.addEventListener("start", cancel);
  draw();
  return () => {
    cancel();
    rt.controls.removeEventListener("start", cancel);
  };
}
