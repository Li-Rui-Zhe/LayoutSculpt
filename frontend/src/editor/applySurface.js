export function applySurface(document, request) {
  const type =
    request.category === "floor"
      ? "rooms"
      : request.category === "walls"
        ? "walls"
        : null;
  if (!type || !request.materialId)
    throw Error("材质应用信息不完整，请重新选择。");
  const next = structuredClone(document);
  const index = next.layout[type].findIndex(
    (item) => item.id === request.targetId,
  );
  const item = next.layout[type][index];
  if (!item || item.edit_hidden)
    throw Error("目标位置已变化，请重新选择房间或墙体。");
  if (item.edit_locked) throw Error("目标已锁定，请先解锁再应用材质。");
  if (type === "rooms") item.floor_material = request.materialId;
  else if (request.side === "both") {
    item.wall_material = request.materialId;
    item.material_left = null;
    item.material_right = null;
  } else if (["left", "right"].includes(request.side))
    item[`material_${request.side}`] = request.materialId;
  else throw Error("请选择墙体应用的侧面。");
  return { document: next, selection: { type, index } };
}
