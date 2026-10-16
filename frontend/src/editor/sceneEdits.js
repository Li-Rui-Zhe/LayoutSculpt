import {
  center,
  clone,
  round,
  wallLength,
  reconcileFurnitureRoom,
  normalizeRotation,
} from "./geometry.js";
import { fitOutline } from "./autoOutline.js";
import { liveObjects } from "./liveModel.js";

export function scenePose(document, selection) {
  const item =
    selection && liveObjects(document, selection.type)[selection.index];
  if (!item) return null;
  if (selection.type === "furniture")
    return {
      x: item.x,
      y: item.y,
      elevation: (item.elevation || 0) + 0.035,
      rotation: item.rotation,
    };
  if (selection.type === "lights")
    return { x: item.x, y: item.y, elevation: item.elevation, rotation: 0 };
  if (selection.type === "rooms")
    return { ...center(item.polygon), elevation: 0.03, rotation: 0 };
  const wall =
    selection.type === "walls"
      ? item
      : document.layout.walls.find((w) => w.id === item.wall_id);
  if (!wall) return null;
  const length = wallLength(wall),
    t =
      selection.type === "walls"
        ? 0.5
        : (item.offset + item.width / 2) / length;
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    y: wall.start.y + (wall.end.y - wall.start.y) * t,
    elevation: selection.type === "walls" ? 0 : item.bottom,
    rotation:
      (Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) * 180) /
      Math.PI,
  };
}
export function sceneModes(type) {
  return type === "lights"
    ? ["translate"]
    : type === "openings"
      ? ["translate", "scale"]
      : ["translate", "rotate", "scale"];
}

// 每次手势始终由开始时的快照计算，避免 mousemove 累计漂移；松手才写入一次撤销记录。
export function applySceneEdit(document, selection, transform) {
  const pose = scenePose(document, selection),
    next = clone(document);
  if (!pose) return document;
  const item = liveObjects(next, selection.type)[selection.index];
  if (item.edit_locked) return document;
  const { x, y, elevation, rotation, scale } = transform;
  if (
    ![x, y, elevation, rotation, scale.x, scale.y, scale.z].every(
      Number.isFinite,
    ) ||
    Math.min(scale.x, scale.y, scale.z) <= 0
  )
    throw Error("尺寸必须为正数，不能翻转或压扁模型。");
  const angle = ((rotation - pose.rotation) * Math.PI) / 180,
    local = (pose.rotation * Math.PI) / 180;
  const point = (p) => {
    const dx = p.x - pose.x,
      dy = p.y - pose.y;
    const lx = (dx * Math.cos(local) + dy * Math.sin(local)) * scale.x;
    const ly = (-dx * Math.sin(local) + dy * Math.cos(local)) * scale.z;
    return {
      x: round(x + lx * Math.cos(local + angle) - ly * Math.sin(local + angle)),
      y: round(y + lx * Math.sin(local + angle) + ly * Math.cos(local + angle)),
    };
  };
  if (selection.type === "furniture") {
    Object.assign(item, {
      x: round(x),
      y: round(y),
      elevation: round(elevation - 0.035),
      rotation: normalizeRotation(rotation),
      width: round(item.width * scale.x),
      depth: round(item.depth * scale.z),
      height: round(item.height * scale.y),
    });
    reconcileFurnitureRoom(next, item);
  } else if (selection.type === "lights")
    Object.assign(item, {
      x: round(x),
      y: round(y),
      elevation: round(elevation),
    });
  else if (selection.type === "rooms") item.polygon = item.polygon.map(point);
  else if (selection.type === "walls") {
    const original = document.layout.walls[selection.index];
    const length = wallLength(original),
      dx = original.end.x - original.start.x,
      dy = original.end.y - original.start.y;
    const near = (p, tolerance) => {
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p.x - original.start.x) * dx + (p.y - original.start.y) * dy) /
            (length * length),
        ),
      );
      return (
        Math.hypot(
          p.x - original.start.x - t * dx,
          p.y - original.start.y - t * dy,
        ) <= tolerance
      );
    };
    const anchor = (p) =>
      [original.start, original.end].some(
        (a) => Math.hypot(p.x - a.x, p.y - a.y) < 0.025,
      );
    next.layout.walls.forEach((w, i) => {
      for (const end of ["start", "end"])
        if (i === selection.index || anchor(w[end])) w[end] = point(w[end]);
    });
    next.layout.rooms.forEach((r) => {
      r.polygon = r.polygon.map((p) =>
        near(p, original.thickness + 0.06) ? point(p) : p,
      );
    });
    if (original.exterior)
      next.layout.outline = next.layout.outline.map((p) =>
        near(p, 0.03) ? point(p) : p,
      );
    item.height = round(item.height * scale.y);
    item.thickness = round(item.thickness * scale.z);
    next.layout.openings
      .filter((o) => o.wall_id === item.id)
      .forEach((o) => {
        o.offset = round(o.offset * scale.x);
        o.width = round(o.width * scale.x);
      });
    for (const region of item.finish_regions || []) {
      region.offset = round(region.offset * scale.x);
      region.width = round(region.width * scale.x);
    }
  } else if (selection.type === "openings") {
    const wall = next.layout.walls.find((w) => w.id === item.wall_id),
      length = wallLength(wall);
    const along =
      ((x - wall.start.x) * (wall.end.x - wall.start.x) +
        (y - wall.start.y) * (wall.end.y - wall.start.y)) /
      length;
    item.width = round(item.width * scale.x);
    item.height = round(item.height * scale.y);
    item.bottom = item.kind === "window" ? round(Math.max(0, elevation)) : 0;
    item.offset = round(
      Math.max(0, Math.min(length - item.width, along - item.width / 2)),
    );
  }
  return fitOutline(document, next);
}
