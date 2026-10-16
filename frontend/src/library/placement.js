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

export function validateFurnitureTemplate(document, template) {
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
}

export function furnitureObstacles(document, template) {
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
  return blocked;
}

function blocksExistingShower(document, item) {
  if (item.kind === "rug" || (item.elevation || 0) >= 1.8) return false;
  const next = {
    ...document,
    furniture: {
      ...document.furniture,
      items: [...document.furniture.items, item],
    },
  };
  return document.furniture.items.some((f) => {
    if (!showerKinds.includes(f.kind)) return false;
    const before = showerPlacementIssues(f, document);
    return showerPlacementIssues(f, next).some(
      (message) => !before.includes(message),
    );
  });
}

export function placeLibraryFurniture(document, template, preferredRoomId) {
  validateFurnitureTemplate(document, template);
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
  const blocked = furnitureObstacles(document, template);
  if (template.kind === "wall_television") {
    const next = clone(document);
    next.furniture.items.push(
      wallPlacement(
        document,
        template,
        rooms,
        blocked,
        null,
        (item) => !blocksExistingShower(document, item),
      ),
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
        if (
          showerPlacementIssues(item, document).length ||
          blocksExistingShower(document, item)
        )
          continue;
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

// 手动落点绝不退回其他房间或移动到远处；预览和确认使用同一套规则。
export function furniturePlacementAt(document, template, point, rotation = 0) {
  let item = {
    ...clone(template),
    x: round(point.x),
    y: round(point.y),
    rotation,
  };
  try {
    validateFurnitureTemplate(document, template);
    if (![point.x, point.y, rotation].every(Number.isFinite))
      throw Error("放置坐标无效。");
    const blocked = furnitureObstacles(document, template);
    if (template.kind === "wall_television") {
      item = wallPlacement(
        document,
        template,
        document.layout.rooms,
        blocked,
        point,
      );
    }
    const room = document.layout.rooms.find((room) => itemFits(item, room));
    if (!room) throw Error("家具超出空间边界，请移入房间或旋转后放置。");
    item.room_id = room.id;
    if (blocked.some((p) => overlapArea(furnitureCorners(item), p) > 1e-6))
      throw Error("此处与家具、墙体或门口通道重叠，请换一个位置。");
    const issues = showerPlacementIssues(item, document);
    if (issues.length) throw Error(issues[0]);
    // 新家具也不能挡住已有淋浴区的入口。
    if (blocksExistingShower(document, item))
      throw Error("此处会挡住淋浴区入口，请留出通行空间。");
    return { item, valid: true, message: "位置可用，点击画布放下" };
  } catch (error) {
    return { item, valid: false, message: error.message };
  }
}

export function commitFurniturePlacement(
  document,
  template,
  point,
  rotation = 0,
) {
  const result = furniturePlacementAt(document, template, point, rotation);
  if (!result.valid) throw Error(result.message);
  const next = clone(document);
  next.furniture.items.push(result.item);
  return next;
}
