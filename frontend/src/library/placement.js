import {
  clone,
  center,
  furnitureCorners,
  itemFits,
  overlapArea,
  round,
} from "../editor/geometry.js";
import { verticalOverlap, wallPlacement } from "./wallPlacement.js";
import {
  showerKinds,
  showerPlacementIssues,
} from "../editor/showerPlacement.js";

export function placeLibraryFurniture(document, template, preferredRoomId) {
  if (document.furniture.items.length >= 90)
    throw Error("最多可放置 90 件家具。");
  if (
    document.furniture.items.reduce(
      (n, f) => n + (f.diy?.parts.length || 0),
      0,
    ) +
      (template.diy?.parts.length || 0) >
    512
  )
    throw Error("单个户型最多容纳 512 个 DIY 部件。");
  if (
    !Number.isFinite(template.elevation ?? 0) ||
    (template.elevation ?? 0) < 0 ||
    (template.elevation ?? 0) > 3 ||
    (template.elevation ?? 0) + template.height > 4.5
  )
    throw Error("家具离地高度应为 0～3 米，顶部不能超过 4.5 米。");
  if (
    ![template.width, template.depth, template.height].every(Number.isFinite) ||
    template.width < 0.1 ||
    template.depth < 0.1 ||
    template.height < 0.02 ||
    template.width > 6 ||
    template.depth > 6 ||
    template.height > 3
  )
    throw Error("家具尺寸超出范围：宽、深 0.1–6 米，高 0.02–3 米。");
  let rooms = [...document.layout.rooms].sort(
    (a, b) =>
      Number(b.id === preferredRoomId) - Number(a.id === preferredRoomId),
  );
  if (!rooms.length) throw Error("请先创建空间，再放置家具。");
  if (showerKinds.includes(template.kind)) {
    rooms = preferredRoomId
      ? rooms.filter((room) => room.id === preferredRoomId)
      : rooms.filter((room) => room.kind === "bathroom");
    if (!rooms.length)
      throw Error("请先选择淋浴区所属空间，或创建卫生间空间，再添加淋浴素材。");
  }
  const obstacles = document.layout.walls.map((w) => ({
    x: (w.start.x + w.end.x) / 2,
    y: (w.start.y + w.end.y) / 2,
    width: Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y),
    depth: w.thickness,
    rotation:
      (Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x) * 180) / Math.PI,
  }));
  for (const o of document.layout.openings.filter((o) =>
    ["door", "passage"].includes(o.kind),
  )) {
    const w = document.layout.walls.find((w) => w.id === o.wall_id);
    if (!w) continue;
    const dx = w.end.x - w.start.x,
      dy = w.end.y - w.start.y,
      length = Math.hypot(dx, dy);
    if (!length) continue;
    const distance = o.offset + o.width / 2;
    obstacles.push({
      x: w.start.x + (dx * distance) / length,
      y: w.start.y + (dy * distance) / length,
      width: o.width,
      depth: w.thickness + 0.9,
      rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
    });
  }
  const blocked = obstacles.map(furnitureCorners);
  if (template.kind !== "rug")
    blocked.push(
      ...document.furniture.items
        .filter((f) => f.kind !== "rug" && verticalOverlap(f, template))
        .map(furnitureCorners),
    );
  if (template.kind === "wall_television") {
    const next = clone(document);
    next.furniture.items.push(
      wallPlacement(document, template, rooms, blocked),
    );
    return next;
  }
  for (const room of rooms) {
    const minX = Math.min(...room.polygon.map((p) => p.x)),
      maxX = Math.max(...room.polygon.map((p) => p.x));
    const minY = Math.min(...room.polygon.map((p) => p.y)),
      maxY = Math.max(...room.polygon.map((p) => p.y));
    const midpoint = center(room.polygon),
      points = [midpoint];
    const step = Math.max(0.2, (maxX - minX) / 60, (maxY - minY) / 60);
    for (let x = minX + step / 2; x < maxX; x += step)
      for (let y = minY + step / 2; y < maxY; y += step) points.push({ x, y });
    points.sort(
      (a, b) =>
        Math.hypot(a.x - midpoint.x, a.y - midpoint.y) -
        Math.hypot(b.x - midpoint.x, b.y - midpoint.y),
    );
    for (const rotation of showerKinds.includes(template.kind)
      ? [0, 90, 180, 270]
      : [0, 90])
      for (const point of points) {
        const item = {
          ...clone(template),
          room_id: room.id,
          x: round(point.x),
          y: round(point.y),
          rotation,
        };
        if (!itemFits(item, room)) continue;
        const corners = furnitureCorners(item);
        if (blocked.some((p) => overlapArea(corners, p) > 1e-6)) continue;
        if (showerPlacementIssues(item, document).length) continue;
        const next = clone(document);
        next.furniture.items.push(item);
        return next;
      }
  }
  throw Error(
    showerKinds.includes(template.kind)
      ? "未找到同时满足实墙安装、窗户避让与入口净空的淋浴位置。请调整卫生间布局或淋浴形式。"
      : "没有找到足够的空位。请先移动已有家具，或在素材库调小放置比例后重试。",
  );
}
