// Wall-local boxes: x runs along the opening, y is elevation, z is depth.
export function openingParts(opening, thickness = 0.16) {
  const { width: w, height: h } = opening,
    bottom = opening.bottom || 0,
    parts = [];
  const bar = Math.min(0.045, w / 8, h / 8),
    glass = opening.glass_type === "frosted" ? "frosted" : "glass";
  const box = (name, size, position, material = "frame", angle = 0) => {
    if (size.every((n) => n > 0))
      parts.push({ name, size, position, material, angle });
  };
  const panel = (
    name,
    x,
    y,
    width,
    height,
    z,
    material,
    angle = 0,
    hinge = null,
  ) => {
    const push = (label, size, px, py, pz, mat) => {
      if (hinge !== null) {
        const dx = px - hinge;
        px = hinge + Math.cos(angle) * dx + Math.sin(angle) * pz;
        pz = -Math.sin(angle) * dx + Math.cos(angle) * pz;
      }
      box(label, size, [px, py, pz], mat, angle);
    };
    push(name, [width, height, 0.025], x, y, z, material);
    if (material === "glass" || material === "frosted") {
      for (const px of [x - width / 2, x + width / 2])
        push("扇竖框", [bar, height, 0.04], px, y, z, "frame");
      for (const py of [y - height / 2, y + height / 2])
        push("扇横框", [width, bar, 0.04], x, py, z, "frame");
    }
    push(
      "把手",
      [0.025, 0.13, 0.045],
      x + width / 2 - 0.1,
      y,
      z + 0.04,
      "metal",
    );
  };
  if (opening.kind === "passage") return parts;
  for (const x of [bar / 2, w - bar / 2])
    box(
      "竖框",
      [bar, h, Math.max(0.07, thickness + 0.02)],
      [x, bottom + h / 2, 0],
    );
  for (const y of opening.kind === "door"
    ? [bottom + h - bar / 2]
    : [bottom + bar / 2, bottom + h - bar / 2])
    box("横框", [w, bar, Math.max(0.07, thickness + 0.02)], [w / 2, y, 0]);
  if (opening.kind === "door") {
    if (opening.door_leaf === false) return parts;
    const style = opening.door_style || "hinged",
      material = opening.door_material === "glass" ? glass : "wood";
    if (style === "sliding") {
      const leaf = (w - 2 * bar) / 2;
      for (let i = 0; i < 2; i++)
        panel(
          "推拉门扇",
          bar + leaf * (i + 0.5),
          bottom + h / 2,
          leaf,
          h - 2 * bar,
          (i - 0.5) * 0.055,
          material,
        );
      box("门下轨", [w, 0.025, 0.13], [w / 2, bottom + 0.0125, 0]);
    } else {
      const angle =
        (((opening.angle ?? 90) * Math.PI) / 180) *
        (opening.swing === "right" ? -1 : 1);
      if (style === "double") {
        const leaf = (w - 2 * bar) / 2;
        panel(
          "双开门扇",
          bar + leaf / 2,
          bottom + h / 2,
          leaf,
          h - 0.05,
          0,
          material,
          angle,
          bar,
        );
        panel(
          "双开门扇",
          w - bar + leaf / 2,
          bottom + h / 2,
          leaf,
          h - 0.05,
          0,
          material,
          Math.PI - angle,
          w - bar,
        );
      } else {
        const end = opening.hinge === "end",
          hinge = end ? w - bar : bar;
        // The end-hinged leaf starts in local +x and rotates back across the opening.
        panel(
          "单开门扇",
          hinge + (w - 2 * bar) / 2,
          bottom + h / 2,
          w - 2 * bar,
          h - 0.05,
          0,
          material,
          angle + (end ? Math.PI : 0),
          hinge,
        );
      }
    }
  } else {
    const style = opening.window_style || "fixed";
    if (style === "fixed") {
      box(
        "固定窗玻璃",
        [w - 2 * bar, h - 2 * bar, 0.018],
        [w / 2, bottom + h / 2, 0],
        glass,
      );
      const count = Math.max(1, Math.ceil(w / 1.2));
      for (let i = 1; i < count; i++)
        box(
          "固定窗中梃",
          [bar, h - 2 * bar, 0.06],
          [(w * i) / count, bottom + h / 2, 0],
        );
    } else {
      const leaf = (w - 2 * bar) / 2;
      for (let i = 0; i < 2; i++)
        panel(
          style === "sliding" ? "推拉窗扇" : "平开窗扇",
          bar + leaf * (i + 0.5),
          bottom + h / 2,
          leaf - bar / 2,
          h - 2 * bar,
          style === "sliding" ? (i - 0.5) * 0.055 : 0,
          glass,
        );
      if (style === "sliding")
        box("窗下轨", [w, 0.025, 0.13], [w / 2, bottom + bar, 0]);
    }
  }
  return parts;
}
