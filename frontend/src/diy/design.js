export const shapes = {
  box: "方体 / 面板",
  cylinder: "圆柱 / 桌腿",
  sphere: "球体 / 软垫",
};
export const categories = {
  furniture: "家具",
  wall_panel: "背景墙 / 屏风",
  decor: "装饰构件",
};
export const promptExamples = [
  {
    name: "玄关柜",
    text: "做一个1.2米宽、0.35米深、0.9米高的原木玄关柜，绿色双开门、黄铜把手，底部留出放鞋空间。",
  },
  {
    name: "圆茶几",
    text: "做一个直径0.8米、高0.4米的圆形茶几，奶油白桌面、三条实木圆柱腿，简洁圆润。",
  },
  {
    name: "格栅背景墙",
    text: "做一面2.4米宽、2.6米高的原木格栅背景墙，含浅色背板、12根竖向格栅和一块悬挑置物板，作为独立装饰构件。",
  },
];
export const materialPresets = [
  { name: "原木", color: "#b88755", roughness: 0.72, metallic: 0 },
  { name: "奶油白", color: "#eee5d4", roughness: 0.5, metallic: 0 },
  { name: "森林绿", color: "#315e49", roughness: 0.48, metallic: 0 },
  { name: "黄铜", color: "#c5a05a", roughness: 0.3, metallic: 0.85 },
  { name: "哑光黑", color: "#303432", roughness: 0.65, metallic: 0.1 },
];

export function updatePlacedDesign(item, design, preserveSize = true) {
  const errors = designIssues(design);
  if (errors.length) throw Error(errors[0]);
  if (item?.kind !== "custom") throw Error("只能更新 DIY 家具");
  const [width, depth, height] = designBounds(design).dimensions;
  return {
    ...structuredClone(item),
    name: design.name,
    diy: structuredClone(design),
    ...(preserveSize ? {} : { width, depth, height }),
  };
}
export function newPart(shape = "box") {
  return {
    id: crypto.randomUUID(),
    name: "新部件",
    shape,
    x: 0,
    y: 0,
    z: 0,
    width: 0.5,
    depth: 0.4,
    height: 0.5,
    rotation: 0,
    color: "#b68b60",
    roughness: 0.6,
    metallic: 0,
  };
}
export function designBounds(design) {
  const rows = design.parts.map((p) => {
    const a = (p.rotation * Math.PI) / 180;
    const rx =
      (Math.abs(Math.cos(a)) * p.width + Math.abs(Math.sin(a)) * p.depth) / 2;
    const ry =
      (Math.abs(Math.sin(a)) * p.width + Math.abs(Math.cos(a)) * p.depth) / 2;
    return [p.x - rx, p.y - ry, p.z, p.x + rx, p.y + ry, p.z + p.height];
  });
  const low = [0, 1, 2].map((i) => Math.min(...rows.map((r) => r[i])));
  const high = [3, 4, 5].map((i) => Math.max(...rows.map((r) => r[i])));
  return {
    low,
    high,
    dimensions: high.map((v, i) => Math.max([0.1, 0.1, 0.02][i], v - low[i])),
  };
}
export function designIssues(design) {
  if (!design || !Array.isArray(design.parts))
    return ["请先生成或选择一个素材"];
  if (design.parts.some((p) => !p || typeof p !== "object"))
    return ["部件数据已损坏，请重新打开素材"];
  const errors = [];
  if (
    typeof design.name !== "string" ||
    !design.name.trim() ||
    design.name.length > 60
  )
    errors.push("素材名称需为 1–60 个字符");
  if (!categories[design.category]) errors.push("请选择素材分类");
  if (!design.parts.length || design.parts.length > 48)
    errors.push("每个素材需包含 1–48 个部件");
  if (new Set(design.parts.map((p) => p.id)).size !== design.parts.length)
    errors.push("部件编号不能重复");
  const limits = {
    x: [-6, 6],
    y: [-6, 6],
    z: [0, 3],
    width: [0.01, 6],
    depth: [0.01, 6],
    height: [0.01, 3],
    rotation: [-360, 360],
    roughness: [0, 1],
    metallic: [0, 1],
  };
  for (const p of design.parts) {
    if (
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 60 ||
      !/^[a-zA-Z0-9_-]{1,40}$/.test(p.id) ||
      !shapes[p.shape] ||
      !/^#[0-9a-fA-F]{6}$/.test(p.color)
    )
      errors.push(`${p.name || "部件"} 的名称、形状、编号或颜色无效`);
    if (
      Object.entries(limits).some(
        ([key, [min, max]]) =>
          !Number.isFinite(p[key]) || p[key] < min || p[key] > max,
      )
    )
      errors.push(`${p.name || "部件"} 的参数超出范围`);
  }
  if (
    design.parts.length &&
    designBounds(design).dimensions.some((n, i) => n > [6, 6, 3][i] + 1e-6)
  )
    errors.push("组合后的宽、深不能超过 6 米，高不能超过 3 米");
  return errors;
}
export function placedDesign(design, point, roomId) {
  const errors = designIssues(design);
  if (errors.length) throw Error(errors[0]);
  const [width, depth, height] = designBounds(design).dimensions;
  return {
    kind: "custom",
    name: design.name,
    room_id: roomId,
    x: point.x,
    y: point.y,
    width,
    depth,
    height,
    rotation: 0,
    diy: structuredClone(design),
  };
}
