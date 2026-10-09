import { compatibleMaterialCategories as materialCategories } from "../catalog.js";
import { isCustomMaterial, resolveMaterial } from "./custom.js";

export function materialSelection(
  state,
  materialId,
  category,
  roomId = state.floorTarget || "all",
) {
  if (!Object.hasOwn(materialCategories, category)) throw Error("未知材质分类");
  if (
    materialId !== null &&
    !isCustomMaterial(materialId) &&
    !materialCategories[category].includes(materialId)
  )
    throw Error("此材质不适用于当前分类");
  if (category === "floor" && roomId !== "all") {
    return {
      ...state,
      category,
      floorTarget: roomId,
      roomFloors: { ...state.roomFloors, [roomId]: materialId },
    };
  }
  return {
    ...state,
    category,
    selected: { ...state.selected, [category]: materialId },
    ...(category === "floor" ? { floorTarget: "all", roomFloors: {} } : {}),
  };
}

export function selectedFloor(state, roomId) {
  return Object.hasOwn(state.roomFloors || {}, roomId)
    ? state.roomFloors[roomId]
    : state.selected?.floor;
}

export function applyFloorDraft(document, state, originalRooms = []) {
  const next = structuredClone(document);
  for (const room of next.layout.rooms) {
    const id = selectedFloor(state, room.id);
    if (room.floor_enabled === false) continue;
    if (id == null) {
      const original = originalRooms.find((r) => r.id === room.id);
      if (original && Object.hasOwn(state.roomFloors || {}, room.id)) {
        room.floor_material = original.floor_material || null;
        room.floor_finish = original.floor_finish || "default";
      }
      continue;
    }
    if (!isCustomMaterial(id) && !materialCategories.floor.includes(id))
      throw Error("地板材质无效，请重新选择");
    room.floor_material = id;
  }
  return next;
}

export function floorColor(room, fallback) {
  return resolveMaterial(room.floor_material)?.color || fallback;
}
