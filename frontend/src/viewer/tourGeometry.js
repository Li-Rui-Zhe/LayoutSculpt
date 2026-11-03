// 漫游导航使用模型实际坐标；只有门/通道能成为跨房间热点。
export function insideRoom(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export function edgeDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function roomClearance(p, polygon) {
  return Math.min(
    ...polygon.map((a, i) =>
      edgeDistance(p, a, polygon[(i + 1) % polygon.length]),
    ),
  );
}
export function standPoints(polygon, obstacles = []) {
  if (polygon.length < 3) return [];
  const xs = polygon.map((p) => p.x),
    ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  // 限制候选数量，大户型不会在进入时卡住主线程。
  const step = Math.max(0.22, Math.max(maxX - minX, maxY - minY) / 48);
  const candidates = [];
  for (let x = minX + step / 2; x < maxX; x += step)
    for (let y = minY + step / 2; y < maxY; y += step) {
      const p = { x, y };
      if (!insideRoom(p, polygon)) continue;
      let clearance = roomClearance(p, polygon);
      for (const box of obstacles) {
        const dx = Math.max(box.minX - x, 0, x - box.maxX),
          dy = Math.max(box.minY - y, 0, y - box.maxY);
        clearance = Math.min(clearance, Math.hypot(dx, dy));
      }
      if (clearance >= 0.28) candidates.push({ ...p, clearance });
    }
  candidates.sort((a, b) => b.clearance - a.clearance);
  const result = [];
  for (const p of candidates) {
    if (result.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > 2.2))
      result.push(p);
    if (result.length === 3) break;
  }
  return result;
}
export function connectPortals(rooms, openings) {
  const links = [];
  for (const o of openings) {
    if (!["door", "passage"].includes(o.kind) || !o.normal) continue;
    const length = Math.hypot(...o.normal);
    if (length < 0.001) continue;
    const n = o.normal.map((v) => v / length);
    const sides = [-1, 1].map((sign) => {
      for (const distance of [0.16, 0.28, 0.42, 0.6]) {
        const p = {
          x: o.x + sign * n[0] * distance,
          y: o.y + sign * n[1] * distance,
        };
        const matches = rooms.filter((r) => insideRoom(p, r.polygon));
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) return null;
      }
      return null;
    });
    if (sides[0] && sides[1] && sides[0].id !== sides[1].id)
      links.push({ ...o, rooms: sides.map((r) => r.id) });
  }
  return links;
}
