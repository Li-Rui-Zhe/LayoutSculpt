import { furnitureCorners, overlapArea, polygonInside } from "./geometry.js";
import { verticalOverlap } from "../library/wallPlacement.js";

// 仅检查正在操作的单件；固定障碍在草稿落定时预计算，不调用后端。
export function placementInspector(document) {
  if (!document) return () => null;
  const walls = document.layout.walls
    .filter((w) => !w.edit_hidden)
    .map((w) => {
      const dx = w.end.x - w.start.x,
        dy = w.end.y - w.start.y,
        length = Math.hypot(dx, dy);
      const openings = document.layout.openings.filter(
        (o) => o.wall_id === w.id && !o.edit_hidden,
      );
      const cuts = [
        ...new Set([
          0,
          length,
          ...openings.flatMap((o) => [o.offset, o.offset + o.width]),
        ]),
      ].sort((a, b) => a - b);
      const segments =
        length < 1e-6
          ? []
          : cuts.slice(1).flatMap((end, i) => {
              const start = cuts[i];
              if (end - start < 1e-6) return [];
              const center = (start + end) / 2,
                opening = openings.find(
                  (o) => center >= o.offset && center <= o.offset + o.width,
                );
              return [
                {
                  opening,
                  polygon: furnitureCorners({
                    x: w.start.x + (dx * center) / length,
                    y: w.start.y + (dy * center) / length,
                    width: end - start,
                    depth: w.thickness,
                    rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
                  }),
                },
              ];
            });
      return { ...w, segments };
    });
  return (current, selection) => {
    if (selection?.type !== "furniture") return null;
    const item = current.furniture.items[selection.index];
    if (!item || item.edit_hidden) return null;
    const corners = furnitureCorners(item);
    const messages = [];
    if (!current.layout.rooms.some((r) => polygonInside(corners, r.polygon)))
      messages.push("超出房间边界");
    const crossing = walls.find(
      (w) =>
        (item.elevation || 0) < w.height &&
        w.segments.some(
          ({ opening, polygon }) =>
            // 落在门窗洞口高度内的物品不误报为撞墙，门口通行另行检查。
            (!opening ||
              (item.elevation || 0) < (opening.bottom || 0) - 1e-6 ||
              (item.elevation || 0) + item.height >
                (opening.bottom || 0) + opening.height + 1e-6) &&
            overlapArea(corners, polygon) > 0.005,
        ),
    );
    if (crossing) messages.push("与墙体相交");
    const other = current.furniture.items.find(
      (f, i) =>
        i !== selection.index &&
        !f.edit_hidden &&
        f.kind !== "rug" &&
        item.kind !== "rug" &&
        verticalOverlap(f, item) &&
        overlapArea(corners, furnitureCorners(f)) > 0.01,
    );
    if (other) messages.push(`与${other.name || "其他家具"}重叠`);
    for (const opening of current.layout.openings) {
      if (
        opening.edit_hidden ||
        !["door", "passage"].includes(opening.kind) ||
        (item.elevation || 0) >= opening.height
      )
        continue;
      const w = walls.find((w) => w.id === opening.wall_id);
      if (!w) continue;
      const length = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      if (!length) continue;
      const t = (opening.offset + opening.width / 2) / length;
      const zone = furnitureCorners({
        x: w.start.x + (w.end.x - w.start.x) * t,
        y: w.start.y + (w.end.y - w.start.y) * t,
        width: opening.width,
        depth: w.thickness + 0.9,
        rotation:
          (Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x) * 180) /
          Math.PI,
      });
      if (overlapArea(corners, zone) > 0.01) {
        messages.push("可能挡住门口通行");
        break;
      }
    }
    return {
      corners,
      warning: messages.length > 0,
      text: messages.slice(0, 2).join(" · ") || "未发现明显重叠",
      item,
    };
  };
}
