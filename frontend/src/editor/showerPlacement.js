import {
  furnitureCorners,
  openingPoints,
  overlapArea,
  contains,
} from "./geometry.js";

export const showerKinds = ["shower", "shower_walk_in", "shower_open"];
const local = (item, x, y) => {
  const a = (item.rotation * Math.PI) / 180;
  return {
    x: item.x + x * Math.cos(a) - y * Math.sin(a),
    y: item.y + x * Math.sin(a) + y * Math.cos(a),
  };
};
const strip = (a, b, depth) =>
  furnitureCorners({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    width: Math.hypot(b.x - a.x, b.y - a.y),
    depth,
    rotation: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  });

export function showerPlacementIssues(item, document) {
  if (!showerKinds.includes(item.kind)) return [];
  const { layout, furniture } = document;
  const issues = [],
    label = item.name || "淋浴区",
    bottom = item.elevation || 0;
  if (Math.min(item.width, item.depth) < 0.8 || item.height < 1.8)
    issues.push(`${label} 过小：湿区宽深至少 0.8 米、花洒高度至少 1.8 米。`);
  if (bottom > 0.15) issues.push(`${label} 离地过高，请落地布置并衔接排水。`);
  if (item.kind !== "shower") {
    const mount = [-0.22, 0.22].map((x) => local(item, x, -item.depth / 2));
    const supported = layout.walls.some((wall) => {
      const length = Math.hypot(
        wall.end.x - wall.start.x,
        wall.end.y - wall.start.y,
      );
      if (length < 0.001 || wall.height < bottom + item.height - 0.05)
        return false;
      if (
        !mount.every((p) =>
          contains(p, strip(wall.start, wall.end, wall.thickness + 0.36)),
        )
      )
        return false;
      const projected = mount.map(
        (p) =>
          ((p.x - wall.start.x) * (wall.end.x - wall.start.x) +
            (p.y - wall.start.y) * (wall.end.y - wall.start.y)) /
          length,
      );
      return !layout.openings.some(
        (o) =>
          o.wall_id === wall.id &&
          Math.min(Math.max(...projected), o.offset + o.width) >
            Math.max(Math.min(...projected), o.offset) + 0.001 &&
          Math.min(bottom + item.height, o.bottom + o.height) >
            Math.max(bottom + 0.8, o.bottom),
      );
    });
    if (!supported)
      issues.push(
        `${label} 花洒后方需要完整实墙，请旋转或移动，避开门窗与通道。`,
      );
  } else {
    const panels = [
      [
        local(item, -item.width / 2, -item.depth / 2),
        local(item, item.width / 2, -item.depth / 2),
      ],
      [
        local(item, item.width / 2, -item.depth / 2),
        local(item, item.width / 2, item.depth / 2),
      ],
    ];
    if (
      layout.openings.some((o) => {
        if (
          o.kind !== "window" ||
          Math.min(bottom + item.height, o.bottom + o.height) <=
            Math.max(bottom, o.bottom)
        )
          return false;
        const wall = layout.walls.find((w) => w.id === o.wall_id);
        return (
          wall &&
          panels.some(
            ([a, b]) =>
              overlapArea(
                strip(a, b, 0.02),
                strip(...openingPoints(o, wall), wall.thickness + 0.4),
              ) > 0.0016,
          )
        );
      })
    )
      issues.push(`${label} 的实体背板遮挡窗户，请移位或改用步入式 / 开放式。`);
  }
  const half = Math.min(0.35, item.width * 0.4);
  const access = [
    [-half, item.depth / 2],
    [half, item.depth / 2],
    [half, item.depth / 2 + 0.55],
    [-half, item.depth / 2 + 0.55],
  ].map(([x, y]) => local(item, x, y));
  const wallsBlocked = layout.walls.some((wall) => {
    const length = Math.hypot(
      wall.end.x - wall.start.x,
      wall.end.y - wall.start.y,
    );
    if (length < 0.001) return false;
    let cursor = 0;
    const holes = layout.openings
      .filter((o) => o.wall_id === wall.id && o.kind !== "window")
      .sort((a, b) => a.offset - b.offset);
    return [...holes, { offset: length, width: 0 }].some((o) => {
      const segment = openingPoints(
        { offset: cursor, width: Math.max(0, o.offset - cursor) },
        wall,
      );
      const blocked =
        o.offset > cursor &&
        overlapArea(access, strip(...segment, wall.thickness)) > 0.012;
      cursor = Math.max(cursor, o.offset + o.width);
      return blocked;
    });
  });
  if (
    wallsBlocked ||
    furniture.items.some(
      (other) =>
        other !== item &&
        other.kind !== "rug" &&
        (other.elevation || 0) < 1.8 &&
        overlapArea(access, furnitureCorners(other)) > 0.025,
    )
  )
    issues.push(`${label} 入口受阻，请在正面留出至少 0.55 米通行空间。`);
  return issues;
}

export function showerProblems(document) {
  return document.furniture.items.flatMap((item, index) =>
    showerPlacementIssues(item, document).map((text) => ({
      type: "furniture",
      index,
      text,
    })),
  );
}
