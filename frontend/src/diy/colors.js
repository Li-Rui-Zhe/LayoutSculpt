export const colorSwatches = [
  ["奶油白", "#eee5d4"],
  ["暖灰", "#a6a39b"],
  ["哑光黑", "#303432"],
  ["原木", "#b88755"],
  ["胡桃木", "#654638"],
  ["陶土红", "#b76b52"],
  ["森林绿", "#315e49"],
  ["鼠尾草绿", "#99aa8c"],
  ["雾蓝", "#7294a7"],
  ["深海蓝", "#304b66"],
  ["柔粉", "#d8aaa3"],
  ["姜黄", "#c5a05a"],
];

export function normalizeColor(value) {
  const hex = String(value ?? "")
    .trim()
    .replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex))
    return `#${[...hex]
      .map((c) => c + c)
      .join("")
      .toLowerCase()}`;
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

export function colorTargets(design, partId, scope) {
  const parts = design?.parts || [];
  const selected = parts.find((p) => p.id === partId);
  if (scope === "all") return parts.map((p) => p.id);
  if (!selected) return [];
  if (scope === "matching")
    return parts
      .filter((p) => normalizeColor(p.color) === normalizeColor(selected.color))
      .map((p) => p.id);
  return [selected.id];
}

export function recolorParts(design, ids, value) {
  const color = normalizeColor(value);
  if (!color || !design) return design;
  const targets = new Set(ids);
  return {
    ...design,
    parts: design.parts.map((p) => (targets.has(p.id) ? { ...p, color } : p)),
  };
}

export function materialTargets(design, partId, scope) {
  const parts = design?.parts || [],
    selected = parts.find((p) => p.id === partId);
  if (scope !== "matching") return colorTargets(design, partId, scope);
  if (!selected) return [];
  return parts
    .filter((p) =>
      selected.material_id
        ? p.material_id === selected.material_id
        : !p.material_id &&
          normalizeColor(p.color) === normalizeColor(selected.color) &&
          (p.roughness ?? 0.7) === (selected.roughness ?? 0.7) &&
          (p.metallic ?? 0) === (selected.metallic ?? 0),
    )
    .map((p) => p.id);
}

// One continuous picker gesture is one undo step; other edits end the group.
export function commitDesign(history, next, group) {
  if (JSON.stringify(next) === JSON.stringify(history.present)) return history;
  return {
    past:
      group && history.group === group
        ? history.past
        : [...history.past, history.present].slice(-60),
    present: next,
    future: [],
    group,
  };
}
