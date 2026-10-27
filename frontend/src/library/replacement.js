import {
  clone,
  furnitureCorners,
  itemFits,
  overlapArea,
} from "../editor/geometry.js";
import {
  furnitureObstacles,
  furniturePlacementAt,
  validateFurnitureTemplate,
} from "./placement.js";

export function replacementCandidates(items, current, archived = []) {
  const available = items.filter(
    (i) => i.placeable && !i.archived && !archived.includes(i.id),
  );
  const source =
    available.find((i) => i.id === current.source_asset_id) ||
    available.find((i) => i.name === current.name);
  const families = [
    ...new Set(available.map((i) => i.family).filter(Boolean)),
  ].sort((a, b) => b.length - a.length);
  const family =
    current.asset_family ||
    source?.family ||
    families.find((f) => current.name?.includes(f));
  return available.filter((i) => {
    if (family) return i.family === family;
    const kind = i.furniture_kind || i.kind;
    if (current.kind === "model" || current.kind === "custom")
      return i.source === "imported" || i.source === "diy";
    return kind === current.kind;
  });
}

export function replaceFurniture(document, index, template) {
  const previous = document.furniture.items[index];
  if (!previous) throw Error("原家具已不存在，请重新选择。");
  if (previous.edit_locked) throw Error("请先解锁家具，再更换款式。");
  const without = clone(document);
  without.furniture.items.splice(index, 1);
  const nextItem = {
    ...clone(template),
    x: previous.x,
    y: previous.y,
    rotation: previous.rotation,
    room_id: previous.room_id,
    elevation: previous.elevation ?? 0,
    name: previous.name || template.name,
    edit_id: previous.edit_id,
    edit_group: previous.edit_group,
    edit_locked: previous.edit_locked ?? false,
    edit_hidden: previous.edit_hidden ?? false,
  };
  validateFurnitureTemplate(without, nextItem);
  const room = document.layout.rooms.find((r) => r.id === previous.room_id);
  if (!room || !itemFits(nextItem, room))
    throw Error(
      "新款超出原房间边界，请选择尺寸更小的款式，或先调整原家具位置。",
    );
  // 原位置校验不做自动移位；隐含的墙面吸附也不得改变用户的位置与朝向。
  const check = furniturePlacementAt(
    without,
    nextItem,
    previous,
    previous.rotation,
  );
  if (!check.valid) throw Error(check.message);
  if (
    Math.abs(check.item.x - previous.x) > 0.002 ||
    Math.abs(check.item.y - previous.y) > 0.002 ||
    Math.abs(check.item.rotation - previous.rotation) > 0.002
  )
    throw Error("新款无法在原位置安装，请先调整原家具位置。");
  if (
    furnitureObstacles(without, nextItem).some(
      (p) => overlapArea(furnitureCorners(nextItem), p) > 1e-6,
    )
  )
    throw Error("新款会与家具、墙体或门口通道重叠，请选择更小的款式。");
  const next = clone(document);
  next.furniture.items[index] = nextItem;
  return next;
}
