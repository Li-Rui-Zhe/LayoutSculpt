import { furnitureCorners, furnitureSpace } from "./geometry.js";
import {
  furnitureCollision,
  structureObstacles,
  structureCollision,
} from "./placementRules.js";

export function placementInspector(document) {
  if (!document) return () => null;
  const structure = structureObstacles(document.layout);
  const space = furnitureSpace(document.layout);
  return (current, selection) => {
    if (selection?.type !== "furniture") return null;
    const item = current.furniture.items[selection.index];
    if (!item || item.edit_hidden) return null;
    const messages = [];
    if (!space(item)) messages.push("超出可用空间边界");
    const hit = structureCollision(item, structure);
    if (hit)
      messages.push(hit.kind === "passage" ? "可能挡住门口通行" : "与墙体相交");
    const other = current.furniture.items.find(
      (f, i) => i !== selection.index && furnitureCollision(item, f),
    );
    if (other) messages.push(`与${other.name || "其他家具"}重叠`);
    return {
      corners: furnitureCorners(item),
      warning: !!messages.length,
      text: messages.slice(0, 2).join(" · ") || "未发现明显重叠",
      item,
    };
  };
}
