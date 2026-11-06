// 仅对明确绑定的陈设联动；不根据距离猜测用户家具的归属。
export function followWallAttachments(previous, changed) {
  if (
    !(changed.layout.presentation_layers || []).some(
      (layer) => layer.parent_wall_id,
    )
  )
    return changed;
  const next = structuredClone(changed);
  const oldWalls = new Map(
    previous.layout.walls.map((wall) => [wall.id, wall]),
  );
  const newWalls = new Map(next.layout.walls.map((wall) => [wall.id, wall]));
  const oldLayers = new Map(
    (previous.layout.presentation_layers || []).map((layer) => [
      layer.id,
      layer,
    ]),
  );
  for (const layer of next.layout.presentation_layers || []) {
    const id = layer.parent_wall_id;
    if (!id) continue;
    const wall = newWalls.get(id),
      oldWall = oldWalls.get(id),
      before = oldLayers.get(layer.id);
    if (!wall) {
      layer.parent_wall_id = null;
      layer.visible = false;
      continue;
    }
    if (
      !oldWall ||
      before?.parent_wall_id !== id ||
      ["x", "y", "rotation"].some(
        (key) => (layer[key] || 0) !== (before[key] || 0),
      )
    )
      continue;
    const angle =
      Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) -
      Math.atan2(
        oldWall.end.y - oldWall.start.y,
        oldWall.end.x - oldWall.start.x,
      );
    const dx = before.x - oldWall.start.x,
      dy = before.y - oldWall.start.y;
    layer.x = wall.start.x + dx * Math.cos(angle) - dy * Math.sin(angle);
    layer.y = wall.start.y + dx * Math.sin(angle) + dy * Math.cos(angle);
    layer.rotation =
      ((((before.rotation || 0) + (angle * 180) / Math.PI) % 360) + 360) % 360;
  }
  return next;
}
