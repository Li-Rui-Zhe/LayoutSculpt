import { designBounds, designIssues } from "./design.js";
export const normalizeGroup = (value) =>
  (value || "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");

export function transformPartGroup(design, group, operation, value) {
  group = normalizeGroup(group);
  if (!group) throw Error("请先填写部件分组路径");
  const next = structuredClone(design);
  const parts = next.parts.filter(
    (p) =>
      normalizeGroup(p.edit_group) === group ||
      normalizeGroup(p.edit_group).startsWith(`${group}/`),
  );
  if (!parts.length) return design;
  if (parts.some((p) => p.edit_locked))
    throw Error("分组含锁定部件，请先解锁后整体变换");
  const { low, high } = designBounds({ parts });
  const cx = (low[0] + high[0]) / 2,
    cy = (low[1] + high[1]) / 2;
  if (operation === "rotate") {
    const a = (value * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    for (const p of parts) {
      const x = p.x - cx,
        y = p.y - cy;
      p.x = cx + x * c - y * s;
      p.y = cy + x * s + y * c;
      p.rotation = (((p.rotation + value) % 360) + 360) % 360;
    }
  } else if (operation === "scale") {
    if (!Number.isFinite(value) || value <= 0)
      throw Error("缩放比例必须大于零");
    for (const p of parts) {
      p.x = cx + (p.x - cx) * value;
      p.y = cy + (p.y - cy) * value;
      p.z = low[2] + (p.z - low[2]) * value;
      for (const key of ["width", "depth", "height"]) p[key] *= value;
    }
  } else if (operation === "move")
    for (const p of parts) {
      p.x += value.x || 0;
      p.y += value.y || 0;
      p.z += value.z || 0;
    }
  else throw Error("不支持的分组操作");
  const errors = designIssues(next);
  if (errors.length) throw Error(errors[0]);
  return next;
}
