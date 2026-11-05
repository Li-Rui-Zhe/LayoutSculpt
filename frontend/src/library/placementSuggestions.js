// 只推荐落点，不提交或移动现有家具；最终仍走同一套碰撞校验。
export function placementSuggestions(document, template, roomId) {
  const points = [];
  if (
    [
      "cabinet",
      "shoe_cabinet",
      "bookshelf",
      "refrigerator",
      "tv_console",
      "bed",
      "sofa",
    ].includes(template.kind)
  ) {
    for (const wall of document.layout.walls.filter((w) => !w.edit_hidden)) {
      const dx = wall.end.x - wall.start.x,
        dy = wall.end.y - wall.start.y,
        length = Math.hypot(dx, dy);
      if (length < template.width + 0.06) continue;
      for (const sign of [1, -1])
        for (const t of [0.5, 0.25, 0.75]) {
          const nx = (-dy / length) * sign,
            ny = (dx / length) * sign;
          const offset = wall.thickness / 2 + template.depth / 2 + 0.025;
          points.push({
            x: wall.start.x + dx * t + nx * offset,
            y: wall.start.y + dy * t + ny * offset,
            rotation: (Math.atan2(-nx, ny) * 180) / Math.PI,
          });
        }
    }
  }
  if (template.kind === "chair") {
    for (const table of document.furniture.items.filter(
      (f) =>
        !f.edit_hidden &&
        f.room_id === roomId &&
        ["table", "desk"].includes(f.kind),
    )) {
      const a = (table.rotation * Math.PI) / 180,
        c = Math.cos(a),
        s = Math.sin(a);
      for (const [x, y, rotation] of [
        [0, -table.depth / 2 - template.depth / 2 - 0.08, 0],
        [0, table.depth / 2 + template.depth / 2 + 0.08, 180],
        [-table.width / 2 - template.depth / 2 - 0.08, 0, 270],
        [table.width / 2 + template.depth / 2 + 0.08, 0, 90],
      ])
        points.push({
          x: table.x + c * x - s * y,
          y: table.y + s * x + c * y,
          rotation: table.rotation + rotation,
        });
    }
  }
  return points;
}
