import { lockedChange } from "./objectIdentity.js";

export const referenceLength = (wall) =>
  Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
export function differentDirection(a, b) {
  const length = referenceLength(a) * referenceLength(b);
  return (
    length > 0 &&
    Math.abs(
      (a.end.x - a.start.x) * (b.end.y - b.start.y) -
        (a.end.y - a.start.y) * (b.end.x - b.start.x),
    ) /
      length >=
      0.5
  );
}

export function dimensionStatus(layout) {
  const basis = layout.dimension_basis;
  if (basis?.source === "user_reference" && basis.anchors?.length) {
    const stale = basis.anchors.some((a) => {
      const wall = layout.walls.find((w) => w.id === a.wall_id);
      return !wall || Math.abs(referenceLength(wall) / a.meters - 1) > 0.02;
    });
    return {
      label: stale
        ? "参考墙已变化 · 请重新校准"
        : `已按${basis.anchors.length > 1 ? "两向" : "一段"}${basis.anchors.every((a) => a.source === "measured") ? "用户实测" : "图纸"}参考长度校准`,
      detail:
        "校准仅调整平面比例，不代表所有墙段、净空和高度均已实测。购买前仍需核对摆放位置。",
    };
  }
  if (basis?.source === "image_dimensions")
    return {
      label: basis.inconsistent
        ? "图上尺寸比例不一致 · 待核对"
        : "图上标注换算 · 未实测",
      detail:
        "标注由 AI 读取，可能读错数字或对应墙段。请用已知墙长校准，并核对其他方向。",
    };
  if (
    basis?.source === "estimated" ||
    /长边\s*10\s*米/.test(layout.scale_note || "")
  )
    return {
      label: "尺寸估算 · 尚未校准",
      detail:
        "未读取可靠尺寸，识别时按建筑长边 10 米估算；当前仅适合布局示意。",
    };
  return {
    label: "尺寸依据待核实",
    detail: "此方案未记录可追溯的尺寸依据；可选择墙体，按已知长度校准。",
  };
}

export function furnitureSizeStatus(item) {
  const ref = item.size_reference;
  if (!ref) return "模型尺寸 · 未核对商品";
  if (
    ["width", "depth", "height"].some(
      (k) => Math.abs(item[k] - ref[k]) > 0.00001,
    )
  )
    return "尺寸已改动 · 请重新核对";
  return ref.source === "measured" ? "用户录入实测尺寸" : "用户录入商品尺寸";
}

export function calibrate(document, measured, actual, options = {}) {
  if (
    ![measured, actual].every((v) => Number.isFinite(v) && v > 0) ||
    actual > 60
  )
    throw Error("请填写有效的参考长度（大于 0、不超过 60 米）。");
  const ratio = actual / measured;
  if (ratio < 0.1 || ratio > 10)
    throw Error("校准比例需在 0.1–10 倍之间，请核对实际长度");
  const wall =
    options.wallId &&
    document.layout.walls.find((w) => w.id === options.wallId);
  if (
    options.wallId &&
    (!wall || Math.abs(referenceLength(wall) - measured) > 0.00001)
  )
    throw Error("参考墙已变化，请重新选择并填写长度。");
  const anchors = wall
    ? [
        {
          wall_id: wall.id,
          meters: actual,
          source: options.source === "measured" ? "measured" : "drawing",
        },
      ]
    : [];
  if (options.secondWallId) {
    const second = document.layout.walls.find(
      (w) => w.id === options.secondWallId,
    );
    if (!wall || !second || !differentDirection(wall, second))
      throw Error("请选择另一方向的墙体作为复核参考。");
    const value = options.secondActual;
    if (!Number.isFinite(value) || value <= 0 || value > 60)
      throw Error("请填写第二段参考长度。");
    const error = Math.abs((referenceLength(second) * ratio) / value - 1);
    if (error > 0.02)
      throw Error(
        `两段比例相差 ${(error * 100).toFixed(1)}%，暂不应用。请检查墙段、标注或图片是否被拉伸；2% 是一致性提醒阈值，不是精度保证。`,
      );
    anchors.push({
      wall_id: second.id,
      meters: value,
      source: anchors[0].source,
    });
  }
  const next = structuredClone(document);
  const point = (p) => {
    p.x *= ratio;
    p.y *= ratio;
  };
  next.layout.outline.forEach(point);
  next.layout.rooms.forEach((r) => r.polygon.forEach(point));
  next.layout.walls.forEach((w) => {
    point(w.start);
    point(w.end);
    w.thickness *= ratio;
    for (const region of w.finish_regions || []) {
      region.offset *= ratio;
      region.width *= ratio;
    }
  });
  next.layout.openings.forEach((o) => {
    o.offset *= ratio;
    o.width *= ratio;
  });
  (next.layout.lights || []).forEach(point);
  // 家具不随房屋拉伸；已绑定的桌面物品保留相对位置。
  const old = new Map(
    document.furniture.items
      .filter((f) => f.edit_id)
      .map((f) => [f.edit_id, f]),
  );
  const moved = new Map();
  const move = (f, seen = new Set()) => {
    if (moved.has(f)) return;
    if (seen.has(f)) throw Error("家具联动存在循环，请先解除循环关系。");
    seen.add(f);
    const before = old.get(f.edit_id),
      parent = next.furniture.items.find(
        (p) => p.edit_id && p.edit_id === f.parent_furniture_id,
      );
    const prior = parent && old.get(parent.edit_id);
    if (before && parent && prior) {
      move(parent, seen);
      f.x = parent.x + before.x - prior.x;
      f.y = parent.y + before.y - prior.y;
    } else point(f);
    moved.set(f, true);
  };
  next.furniture.items.forEach((f) => move(f));
  (next.layout.presentation_layers || []).forEach((layer) => {
    const parent = next.furniture.items.find(
      (p) => p.edit_id && p.edit_id === layer.parent_furniture_id,
    );
    const prior = parent && old.get(parent.edit_id);
    if (prior) {
      layer.x += parent.x - prior.x;
      layer.y += parent.y - prior.y;
    } else point(layer);
  });
  const points = [
    ...next.layout.outline,
    ...next.layout.rooms.flatMap((r) => r.polygon),
    ...next.layout.walls.flatMap((w) => [w.start, w.end]),
    ...(next.layout.lights || []),
    ...next.furniture.items,
    ...(next.layout.presentation_layers || []),
  ];
  if (
    points.some(
      (p) => ![p.x, p.y].every((v) => Number.isFinite(v) && Math.abs(v) <= 60),
    )
  )
    throw Error("校准后对象将超出 ±60 米坐标范围，请核对参考长度。");
  if (next.layout.walls.some((w) => w.thickness < 0.06 || w.thickness > 0.6))
    throw Error(
      "校准后墙厚超出支持范围（6～60 厘米），请核对参考长度或先调整墙厚。",
    );
  if (
    next.layout.openings.some((o) => o.offset > 60 || o.width > 60) ||
    next.layout.walls.some((w) =>
      (w.finish_regions || []).some(
        (r) => r.width < 0.05 || r.width > 60 || r.offset > 60,
      ),
    )
  )
    throw Error("校准后门窗或局部饰面尺寸超出支持范围，请核对参考长度。");
  const violation = lockedChange(document, next);
  if (violation) throw Error(`无法校准：${violation} 请先解除相关对象锁定。`);
  next.layout.dimension_basis = {
    source: anchors.length ? "user_reference" : "unknown",
    anchors,
    inconsistent: false,
  };
  next.layout.scale_note = `用户按参考长度校准平面：${measured.toFixed(3)} m → ${actual.toFixed(3)} m；家具尺寸及所有高度未缩放，其他墙段与净空仍需核实。`;
  return next;
}
