import { reconcileFurnitureRoom } from "./geometry.js";

export function batchFurniture(document, indices, operation, delta = {}) {
  const next = structuredClone(document);
  const unique = [...new Set(indices)].filter(
    (i) => next.furniture.items[i] && !next.furniture.items[i].edit_locked,
  );
  const items = unique.map((i) => next.furniture.items[i]);
  if (!items.length) return next;
  if (["group", "ungroup", "hide"].includes(operation)) {
    const group = operation === "group" ? crypto.randomUUID() : null;
    items.forEach((i) => {
      if (operation === "hide") i.edit_hidden = true;
      else i.edit_group = group;
    });
    return next;
  }
  if (operation === "delete") {
    next.furniture.items = next.furniture.items.filter(
      (_, i) => !unique.includes(i),
    );
    return next;
  }
  if (operation === "copy") {
    if (next.furniture.items.length + items.length > 90)
      throw Error("家具过多，请先整理对象");
    next.furniture.items.push(
      ...items.map((i) => ({
        ...structuredClone(i),
        edit_group: null,
        edit_locked: false,
        name: `${i.name || "家具"} 副本`.slice(0, 60),
        x: i.x + 0.2,
        y: i.y + 0.2,
      })),
    );
  } else if (operation === "move")
    items.forEach((i) => {
      i.x += delta.x || 0;
      i.y += delta.y || 0;
    });
  else if (operation === "align-x" || operation === "align-y") {
    const axis = operation.at(-1);
    const average = items.reduce((sum, i) => sum + i[axis], 0) / items.length;
    items.forEach((i) => {
      i[axis] = average;
    });
  } else if (operation === "distribute" && items.length > 2) {
    items.sort((a, b) => a.x - b.x);
    const step = (items.at(-1).x - items[0].x) / (items.length - 1);
    const start = items[0].x;
    items.forEach((i, k) => {
      i.x = start + k * step;
    });
  }
  next.furniture.items.forEach((i) => reconcileFurnitureRoom(next, i));
  return next;
}
