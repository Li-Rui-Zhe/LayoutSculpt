// Floors can share a GLTF material. Isolate each room before editing it.
export function isolateRoomFloors(model) {
  if (model.userData.roomFloorCatalog) return model.userData.roomFloorCatalog;
  const rooms = new Map();
  const replaced = new Set();
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    const roomId =
      obj.userData.floor_room_id ||
      (obj.userData.structure_kind === "room" && obj.userData.room_id);
    if (!roomId) return;
    [obj.material].flat().forEach((m) => replaced.add(m));
    obj.material = Array.isArray(obj.material)
      ? obj.material.map((m) => m.clone())
      : obj.material.clone();
    for (const material of [obj.material].flat()) {
      material.userData.surface_category = "floor";
      material.userData.floor_room_id = roomId;
    }
    if (obj.userData.structure_kind === "room")
      rooms.set(roomId, {
        id: roomId,
        name: obj.userData.room_name || obj.name.replace(/_\d+$/, "") || roomId,
      });
  });
  model.traverse((obj) => {
    if (obj.isMesh) [obj.material].flat().forEach((m) => replaced.delete(m));
  });
  replaced.forEach((material) => material.dispose());
  model.userData.roomFloorCatalog = [...rooms.values()];
  return model.userData.roomFloorCatalog;
}
