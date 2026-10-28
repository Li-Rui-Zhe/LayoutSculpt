export const boundaryNames = {
  wall: "普通实墙",
  parapet: "实体低栏板",
  glass_railing: "玻璃栏板",
  glazing: "封闭阳台玻璃",
};

export const balconyNames = {
  unknown: "待核对",
  open: "开放阳台",
  enclosed: "封闭阳台",
};
export const isGlassBoundary = (wall) =>
  ["glass_railing", "glazing"].includes(wall.boundary_type);

export function changeBoundary(document, index, type, dimensions = {}) {
  if (!Object.hasOwn(boundaryNames, type))
    throw Error("请选择有效的围护形式。");
  const next = structuredClone(document),
    wall = next.layout.walls[index];
  if (!wall) throw Error("围护墙段不存在。");
  if (wall.edit_locked) throw Error("此墙段已锁定，请先解锁。");
  if (
    (wall.boundary_type || "wall") === type &&
    !Object.keys(dimensions).length
  )
    return next;
  if (wall.load_bearing)
    throw Error("请先核实承重结构，不能直接改成阳台栏板或玻璃。");
  const previous = wall.boundary_type || "wall";
  wall.boundary_type = type;
  wall.sill_height = type === "glass_railing" ? 0.15 : 0;
  if (["parapet", "glass_railing"].includes(type)) wall.height = 1.1;
  else if (["parapet", "glass_railing"].includes(previous))
    wall.height = Math.max(2.7, wall.height);
  if (type === "glazing" && wall.height < 2) wall.height = 2.7;
  for (const key of ["height", "thickness", "sill_height"])
    if (dimensions[key] !== undefined) wall[key] = dimensions[key];
  if (
    !Number.isFinite(wall.height) ||
    wall.height < 0.3 ||
    wall.height > 4.5 ||
    !Number.isFinite(wall.thickness) ||
    wall.thickness < 0.06 ||
    wall.thickness > 0.6
  )
    throw Error("围护总高需为 0.30–4.50 m，厚度需为 0.06–0.60 m。");
  if (
    isGlassBoundary(wall) &&
    (!Number.isFinite(wall.sill_height) ||
      wall.sill_height < 0 ||
      wall.sill_height >= wall.height)
  )
    throw Error("玻璃基座必须低于围护总高度。");
  const openings = next.layout.openings.filter((o) => o.wall_id === wall.id);
  if (openings.some((o) => o.edit_locked))
    throw Error("此墙段包含锁定的门窗或通道，请先核对并解锁。");
  if (type === "glass_railing" && openings.length)
    throw Error("此墙段有门窗或通道，请先调整开口或拆分墙段，再改为玻璃栏板。");
  if (openings.some((o) => o.bottom + o.height > wall.height + 1e-6))
    throw Error("降低围护后会截断现有门窗，请先调整开口或拆分墙段。");
  if (
    (wall.finish_regions || []).some(
      (r) => r.bottom + r.height > wall.height + 1e-6,
    )
  )
    throw Error("降低围护后会截断局部饰面，请先调整饰面区域。");
  return next;
}

export function boundaryProblems(wall, openings) {
  if (!Object.hasOwn(boundaryNames, wall.boundary_type || "wall"))
    return "围护形式无效。";
  if (!isGlassBoundary(wall)) return null;
  if (wall.load_bearing) return "承重实墙不能直接转换为玻璃围护。";
  const sill = wall.sill_height ?? 0;
  if (!Number.isFinite(sill) || sill < 0 || sill >= wall.height)
    return "玻璃基座必须低于围护总高度。";
  if (
    wall.boundary_type === "glass_railing" &&
    openings.some((o) => o.wall_id === wall.id)
  )
    return "玻璃栏板不能安装门窗，请先拆分墙段。";
  return null;
}

export function boundaryFrameParts(wall, openings = []) {
  if (!isGlassBoundary(wall)) return [];
  const length = Math.hypot(
    wall.end.x - wall.start.x,
    wall.end.y - wall.start.y,
  );
  const bottom = wall.sill_height || 0,
    top = wall.height;
  const bar = Math.min(0.025, (top - bottom) / 4, length / 4);
  const count = Math.max(1, Math.ceil(length / 1.2));
  const offsets = [
    ...new Set([
      0,
      length,
      ...Array.from(
        { length: count - 1 },
        (_, i) => (length * (i + 1)) / count,
      ),
      ...openings.flatMap((o) => [o.offset, o.offset + o.width]),
    ]),
  ].sort((a, b) => a - b);
  const parts = [];
  for (let i = 1; i < offsets.length; i++) {
    const a = offsets[i - 1],
      b = offsets[i];
    for (const [low, high] of [
      [bottom, bottom + bar],
      [top - bar, top],
    ]) {
      if (
        !openings.some(
          (o) =>
            o.offset < (a + b) / 2 &&
            (a + b) / 2 < o.offset + o.width &&
            o.bottom < high &&
            o.bottom + o.height > low,
        )
      )
        parts.push([a, b, low, high]);
    }
  }
  for (const offset of offsets) {
    const a = Math.max(0, offset - bar / 2),
      b = Math.min(length, offset + bar / 2);
    let low = bottom;
    for (const o of [...openings].sort((a, b) => a.bottom - b.bottom)) {
      if (o.offset + 1e-6 < offset && offset < o.offset + o.width - 1e-6) {
        if (o.bottom > low) parts.push([a, b, low, Math.min(top, o.bottom)]);
        low = Math.max(low, o.bottom + o.height);
      }
    }
    if (top > low) parts.push([a, b, low, top]);
  }
  return parts;
}
