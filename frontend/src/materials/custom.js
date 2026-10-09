import { materials } from "../catalog.js";

export function normalizeHex(value) {
  const hex = String(value ?? "")
    .trim()
    .replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

// Store the color in the identifier so task snapshots and room drafts are self-contained.
export function customMaterial(color) {
  const normalized = normalizeHex(color);
  if (!normalized) throw Error("请输入有效的六位 HEX 色号");
  return {
    id: `color:${normalized}`,
    color: normalized,
    name: "自定义颜色",
    sub: "DIY 纯色配色",
    texture: "",
  };
}

export function resolveMaterial(id) {
  if (typeof id === "string" && /^color:#[0-9a-f]{6}$/i.test(id))
    return customMaterial(id.slice(6));
  return materials.find((m) => m.id === id);
}

export function isCustomMaterial(id) {
  return typeof id === "string" && /^color:#[0-9a-f]{6}$/i.test(id);
}
