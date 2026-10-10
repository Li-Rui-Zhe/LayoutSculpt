import { contains } from "./geometry.js";

export function nextWallFinish(wall) {
  const regions = wall.finish_regions || [],
    length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const width = Math.min(1, length),
    height = Math.min(1, wall.height);
  for (const side of ["left", "right"]) {
    const existing = regions.filter((r) => r.side === side);
    for (const bottom of [
      0,
      ...existing.map((r) => r.bottom + r.height + 0.02),
    ])
      for (const offset of [
        0,
        ...existing.map((r) => r.offset + r.width + 0.02),
      ]) {
        if (
          offset + width > length + 0.001 ||
          bottom + height > wall.height + 0.001
        )
          continue;
        if (
          existing.some(
            (r) =>
              offset < r.offset + r.width - 0.001 &&
              offset + width > r.offset + 0.001 &&
              bottom < r.bottom + r.height - 0.001 &&
              bottom + height > r.bottom + 0.001,
          )
        )
          continue;
        return { side, offset, width, bottom, height, material: "wall-oak" };
      }
  }
  return null;
}

export function wallSides(wall, rooms) {
  const dx = wall.end.x - wall.start.x,
    dy = wall.end.y - wall.start.y,
    length = Math.hypot(dx, dy);
  if (!length) return [];
  return [1, -1].map((sign, index) => {
    const offset = Math.max(0.25, wall.thickness / 2 + 0.08);
    const point = {
      x: (wall.start.x + wall.end.x) / 2 - ((sign * dy) / length) * offset,
      y: (wall.start.y + wall.end.y) / 2 + ((sign * dx) / length) * offset,
    };
    return {
      ...point,
      side: index ? "right" : "left",
      label: index ? "B" : "A",
      room:
        rooms.find((r) => contains(point, r.polygon))?.name ||
        "室外 / 未划分空间",
    };
  });
}

export function calibrate(document, measured, actual) {
  const ratio = actual / measured;
  if (!Number.isFinite(ratio) || ratio < 0.1 || ratio > 10)
    throw Error("校准比例需在 0.1–10 倍之间，请核对实际长度");
  const next = structuredClone(document);
  const point = (p) => {
    p.x *= ratio;
    p.y *= ratio;
  };
  next.layout.outline.forEach(point);
  next.layout.rooms.forEach((r) => r.polygon.forEach(point));
  next.layout.walls.forEach((w) => {
    point(w.start);
    point(w.end);
    w.thickness *= ratio;
    for (const region of w.finish_regions || []) {
      region.offset *= ratio;
      region.width *= ratio;
    }
  });
  next.layout.openings.forEach((o) => {
    o.offset *= ratio;
    o.width *= ratio;
  });
  next.layout.lights.forEach(point);
  next.furniture.items.forEach((f) => {
    point(f);
    f.width *= ratio;
    f.depth *= ratio;
  });
  next.layout.scale_note = `用户按已知长度校准平面：${measured.toFixed(3)} m → ${actual.toFixed(3)} m；高度未缩放。`;
  return next;
}

export function snapFurniture(document, index, threshold = 0.12) {
  const next = structuredClone(document),
    f = next.furniture.items[index];
  if (!f || f.edit_locked) return next;
  const a = (f.rotation * Math.PI) / 180;
  let closest = null;
  for (const w of next.layout.walls) {
    const dx = w.end.x - w.start.x,
      dy = w.end.y - w.start.y,
      length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const tx = dx / length,
      ty = dy / length,
      nx = -ty,
      ny = tx;
    const projection = (f.x - w.start.x) * tx + (f.y - w.start.y) * ty;
    if (projection < 0 || projection > length) continue;
    const distance = (f.x - w.start.x) * nx + (f.y - w.start.y) * ny;
    const radius =
      (Math.abs(nx * Math.cos(a) + ny * Math.sin(a)) * f.width +
        Math.abs(-nx * Math.sin(a) + ny * Math.cos(a)) * f.depth) /
      2;
    const delta =
      (distance >= 0 ? 1 : -1) * (radius + w.thickness / 2 + 0.005) - distance;
    if (
      Math.abs(delta) <= threshold &&
      (!closest || Math.abs(delta) < Math.abs(closest.delta))
    )
      closest = { nx, ny, delta };
  }
  if (closest) {
    f.x += closest.nx * closest.delta;
    f.y += closest.ny * closest.delta;
  }
  return next;
}
