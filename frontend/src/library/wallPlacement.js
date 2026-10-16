import {
  furnitureCorners,
  itemFits,
  overlapArea,
  round,
} from "../editor/geometry.js";

export const verticalOverlap = (a, b) =>
  Math.min((a.elevation ?? 0) + a.height, (b.elevation ?? 0) + b.height) >
  Math.max(a.elevation ?? 0, b.elevation ?? 0) + 1e-6;

export function wallPlacement(
  document,
  template,
  rooms,
  blocked,
  anchor = null,
  accept = () => true,
) {
  const candidates = [];
  for (const room of rooms) {
    for (const wall of document.layout.walls) {
      const dx = wall.end.x - wall.start.x,
        dy = wall.end.y - wall.start.y;
      const length = Math.hypot(dx, dy);
      if (
        length < template.width + 0.04 ||
        (template.elevation ?? 0) + template.height + 0.035 > wall.height
      )
        continue;
      const margin = template.width / 2 + 0.02;
      const centers = anchor
        ? [
            Math.max(
              margin,
              Math.min(
                length - margin,
                ((anchor.x - wall.start.x) * dx +
                  (anchor.y - wall.start.y) * dy) /
                  length,
              ),
            ),
          ]
        : [length / 2];
      for (
        let offset = anchor ? Infinity : margin;
        offset <= length - margin;
        offset += 0.2
      )
        centers.push(offset);
      for (const offset of centers) {
        if (
          document.layout.openings.some(
            (o) =>
              o.wall_id === wall.id &&
              offset + template.width / 2 > o.offset &&
              offset - template.width / 2 < o.offset + o.width &&
              (o.kind !== "window" ||
                ((template.elevation ?? 0) < o.bottom + o.height &&
                  (template.elevation ?? 0) + template.height > o.bottom)),
          )
        )
          continue;
        for (const sign of [1, -1]) {
          const nx = (-dy / length) * sign,
            ny = (dx / length) * sign;
          const distance = wall.thickness / 2 + template.depth / 2 + 0.008;
          const item = {
            ...structuredClone(template),
            room_id: room.id,
            x: round(wall.start.x + (dx / length) * offset + nx * distance),
            y: round(wall.start.y + (dy / length) * offset + ny * distance),
            rotation: round((Math.atan2(-nx, ny) * 180) / Math.PI),
          };
          if (
            itemFits(item, room) &&
            accept(item) &&
            !blocked.some((p) => overlapArea(furnitureCorners(item), p) > 1e-6)
          ) {
            if (!anchor) return item;
            const distance = Math.hypot(item.x - anchor.x, item.y - anchor.y);
            if (distance <= 0.75) candidates.push({ item, distance });
          }
        }
      }
    }
  }
  if (candidates.length)
    return candidates.sort((a, b) => a.distance - b.distance)[0].item;
  if (anchor)
    throw Error("请靠近可安装电视的完整墙面，避开门窗；电视将自动贴墙。");
  throw Error(
    "没有找到可安装电视的完整墙面，请检查墙面宽度、高度、门窗和同高度家具。",
  );
}
