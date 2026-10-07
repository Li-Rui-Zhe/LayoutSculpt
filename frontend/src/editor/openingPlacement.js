import { round, wallLength } from "./geometry.js";

// Use the actual free wall segments. Default padding is a placement preference,
// not a hidden minimum that rejects an otherwise valid opening.
export function openingGaps(layout, wall) {
  if (!wall) return [];
  const length = wallLength(wall);
  const occupied = layout.openings
    .filter((opening) => opening.wall_id === wall.id)
    .map((opening) => [
      Math.min(length, Math.max(0, opening.offset)),
      Math.max(0, Math.min(length, opening.offset + opening.width)),
    ])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cursor = 0;
  for (const [start, end] of occupied) {
    if (start > cursor) gaps.push({ start: round(cursor), end: round(start) });
    cursor = Math.max(cursor, end);
  }
  if (cursor < length) gaps.push({ start: round(cursor), end: round(length) });
  return gaps;
}

export function openingPosition(layout, wall, width) {
  const gap = openingGaps(layout, wall).find(
    (gap) => gap.end - gap.start + 1e-6 >= width,
  );
  return gap
    ? round(
        gap.start +
          Math.min(0.05, Math.max(0, (gap.end - gap.start - width) / 2)),
      )
    : 0;
}

export function validateOpening(layout, opening) {
  const errors = [];
  const wall = layout.walls.find((wall) => wall.id === opening.wall_id);
  if (!wall) return ["请先选择安装墙体。"];
  if (layout.openings.length >= 80) errors.push("最多可放置 80 个门窗或通道。");
  if (!["door", "window", "passage"].includes(opening.kind))
    errors.push("请选择有效的开口类型。");
  const { offset, width, height, bottom } = opening;
  if (![offset, width, height, bottom].every(Number.isFinite))
    return [...errors, "请填写完整的宽度、高度和位置。"];
  if (width < 0.1 || width > 60) errors.push("宽度应在 0.1～60 米之间。");
  if (height < 0.1 || height > 4.5) errors.push("高度应在 0.1～4.5 米之间。");
  if (bottom < 0 || bottom > 3) errors.push("窗台离地应在 0～3 米之间。");
  if (offset < 0 || offset > 60 || offset + width > wallLength(wall) + 1e-6)
    errors.push(
      `开口超出墙体，请调整宽度或距墙起点；墙长 ${round(wallLength(wall))} 米。`,
    );
  if (bottom + height > wall.height + 1e-6)
    errors.push(`开口顶部超出 ${wall.height} 米的墙高，请降低高度或窗台。`);
  if (
    layout.openings.some(
      (item) =>
        item.wall_id === wall.id &&
        offset < item.offset + item.width - 1e-6 &&
        offset + width > item.offset + 1e-6,
    )
  )
    errors.push("与已有门窗或通道重叠，请调整位置或宽度。");
  if (
    opening.kind === "door" &&
    opening.door_leaf !== false &&
    (!Number.isFinite(opening.angle) ||
      opening.angle < 0 ||
      opening.angle > 110)
  )
    errors.push("门扇开启角度应在 0～110°之间。");
  return errors;
}
