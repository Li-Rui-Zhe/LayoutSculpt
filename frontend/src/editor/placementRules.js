import { furnitureCorners, overlapArea } from "./planShapes.js";

export const heightOverlap = (a, b) =>
  Math.min((a.elevation || 0) + a.height, (b.elevation || 0) + b.height) >
  Math.max(a.elevation || 0, b.elevation || 0) + 1e-6;

// 与后端保持同一容差：餐椅可浅入桌沿，其余家具仅容许建模误差。
export function furnitureCollision(a, b) {
  if (
    a.edit_hidden ||
    b.edit_hidden ||
    a.kind === "rug" ||
    b.kind === "rug" ||
    !heightOverlap(a, b)
  )
    return false;
  const dining =
    a.kind !== b.kind &&
    [a.kind, b.kind].every((k) => ["chair", "table", "desk"].includes(k));
  return (
    overlapArea(furnitureCorners(a), furnitureCorners(b)) >
    Math.max(
      0.012,
      Math.min(a.width * a.depth, b.width * b.depth) * (dining ? 0.35 : 0.06),
    )
  );
}

// 草稿落定后预计算墙段，移动时按高度判断，窗洞不当作整面实墙。
export function structureObstacles(layout) {
  const parts = [];
  for (const wall of layout.walls.filter((w) => !w.edit_hidden)) {
    const dx = wall.end.x - wall.start.x,
      dy = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const openings = layout.openings.filter(
      (o) => !o.edit_hidden && o.wall_id === wall.id,
    );
    const cuts = [
      ...new Set([
        0,
        length,
        ...openings.flatMap((o) => [
          Math.max(0, Math.min(length, o.offset)),
          Math.max(0, Math.min(length, o.offset + o.width)),
        ]),
      ]),
    ].sort((a, b) => a - b);
    const polygon = (start, end, depth) =>
      furnitureCorners({
        x: wall.start.x + (dx * (start + end)) / (2 * length),
        y: wall.start.y + (dy * (start + end)) / (2 * length),
        width: end - start,
        depth,
        rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
      });
    for (let i = 1; i < cuts.length; i++) {
      const start = cuts[i - 1],
        end = cuts[i],
        mid = (start + end) / 2;
      const opening = openings.find(
        (o) => mid > o.offset && mid < o.offset + o.width,
      );
      const spans = opening
        ? [
            [0, opening.bottom || 0],
            [
              (opening.bottom || 0) + (opening.height ?? 2.1),
              wall.height ?? 2.8,
            ],
          ]
        : [[0, wall.height ?? 2.8]];
      for (const [bottom, top] of spans)
        if (top > bottom + 1e-6)
          parts.push({
            polygon: polygon(start, end, wall.thickness),
            elevation: bottom,
            height: top - bottom,
            kind: "wall",
          });
    }
    for (const o of openings.filter(
      (o) => ["door", "passage"].includes(o.kind) && o.width > 0.17,
    ))
      parts.push({
        polygon: polygon(o.offset + 0.06, o.offset + o.width - 0.06, 0.9),
        elevation: o.bottom || 0,
        height: o.height ?? 2.1,
        kind: "passage",
      });
  }
  return parts;
}

export function structureCollision(item, parts) {
  const corners = furnitureCorners(item);
  return parts.find(
    (p) =>
      heightOverlap(item, p) &&
      overlapArea(corners, p.polygon) > (p.kind === "passage" ? 0.035 : 1e-6),
  );
}
