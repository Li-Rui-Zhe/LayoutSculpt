import { walkAreaError } from "./tourWalking.js";

export const MOVE_KEYS = {
  KeyW: "forward",
  KeyS: "backward",
  KeyA: "left",
  KeyD: "right",
};

// 移动始终沿水平地面，抬头/低头不改变行走高度；斜向不加速。
export function movementDelta(directions, yaw, distance) {
  let forward =
    Number(directions.has("forward")) - Number(directions.has("backward"));
  let right = Number(directions.has("right")) - Number(directions.has("left"));
  const length = Math.hypot(forward, right);
  if (!length) return { x: 0, y: 0 };
  forward *= distance / length;
  right *= distance / length;
  return {
    x: Math.sin(yaw) * forward + Math.cos(yaw) * right,
    y: -Math.cos(yaw) * forward + Math.sin(yaw) * right,
  };
}

export function moveOnFloor(from, delta, regions, obstacles) {
  const target = { x: from.x + delta.x, y: from.y + delta.y };
  if (!walkAreaError(from, target, regions, obstacles)) return target;
  // 斜着靠墙时保留沿墙的分量；仍对完整线段检测，不能穿薄墙。
  const slides = [
    { x: target.x, y: from.y },
    { x: from.x, y: target.y },
  ].sort(
    (a, b) =>
      Math.hypot(b.x - from.x, b.y - from.y) -
      Math.hypot(a.x - from.x, a.y - from.y),
  );
  return (
    slides.find((p) => !walkAreaError(from, p, regions, obstacles)) || from
  );
}
