import { center } from "../editor/geometry.js";
import { placementSuggestions } from "./placementSuggestions.js";
import { furniturePlacementAt } from "./placement.js";

// 只做有限数量的落点试探，不跑全屋网格搜索，也不提交设计。
export function initialPlacement(document, template, preferredRoomId) {
  const rooms = document.layout.rooms
    .filter((r) => !r.edit_hidden)
    .sort(
      (a, b) =>
        Number(b.id === preferredRoomId) - Number(a.id === preferredRoomId),
    );
  for (const room of rooms.slice(0, 4)) {
    const points = [
      ...placementSuggestions(document, template, room.id).slice(0, 10),
      { ...center(room.polygon), rotation: template.rotation || 0 },
    ];
    for (const point of points) {
      const result = furniturePlacementAt(
        document,
        template,
        point,
        point.rotation,
      );
      if (result.valid && result.item.room_id === room.id) return result.item;
    }
  }
  return null;
}
