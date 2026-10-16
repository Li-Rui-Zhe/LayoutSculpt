export const SURFACE_MODES = ["ai", "draw", "preset", "upload"];
export const MODE_LABELS = {
  ai: "AI 生成",
  draw: "手绘创作",
  preset: "选用样板",
  upload: "上传图片",
};

export function emptySurface(category, mode) {
  const label = category === "walls" ? "墙面" : "地板";
  return {
    name: `我的${label}${mode === "draw" ? "手绘" : mode === "ai" ? " AI" : ""}材质`,
    category,
    base_id: "",
    color: "#ffffff",
    repeat: 1,
    rotation: 0,
    roughness: 0.8,
    origin: mode,
  };
}

export function sourceRecipe(previous, source, reset = true) {
  return {
    ...previous,
    base_id: source.id,
    origin: source.origin,
    ...(reset
      ? {
          color: "#ffffff",
          repeat: 1,
          rotation: 0,
          optics: source.optics ?? null,
        }
      : {}),
  };
}

export function restoreSurfaces(category, bases, stored, legacy) {
  const drafts = Object.fromEntries(
    SURFACE_MODES.map((mode) => [mode, emptySurface(category, mode)]),
  );
  drafts.preset = {
    ...drafts.preset,
    base_id: bases[0].id,
    name: `${bases[0].name} · 自定义`,
    color: bases[0].color,
    roughness: bases[0].roughness ?? 0.8,
  };
  const valid = (value) =>
    value &&
    value.category === category &&
    (value.base_id === "" ||
      bases.some((m) => m.id === value.base_id) ||
      /^(source|texture):[a-f0-9]{64}$/.test(value.base_id)) &&
    typeof value.name === "string" &&
    /^#[a-f0-9]{6}$/i.test(value.color) &&
    Number.isInteger(value.repeat) &&
    value.repeat >= 1 &&
    value.repeat <= 6 &&
    [0, 90, 180, 270].includes(value.rotation) &&
    Number.isFinite(value.roughness) &&
    value.roughness >= 0 &&
    value.roughness <= 1 &&
    (value.optics == null ||
      [
        ["transmission", 0, 1],
        ["metalness", 0, 1],
        ["ior", 1, 2.5],
        ["thickness", 0, 0.5],
      ].every(
        ([key, min, max]) =>
          Number.isFinite(value.optics[key]) &&
          value.optics[key] >= min &&
          value.optics[key] <= max,
      ));
  for (const mode of SURFACE_MODES) {
    const value = stored?.drafts?.[mode];
    if (valid(value)) drafts[mode] = { ...drafts[mode], ...value, category };
  }
  if (!stored && valid(legacy)) {
    const mode = bases.some((m) => m.id === legacy.base_id)
      ? "preset"
      : SURFACE_MODES.includes(legacy.origin)
        ? legacy.origin
        : "upload";
    drafts[mode] = { ...drafts[mode], ...legacy, category };
  }
  return {
    mode: SURFACE_MODES.includes(stored?.mode) ? stored.mode : "ai",
    drafts,
  };
}

// 只有当前页的内容状态影响保存；其他创作方式的草稿不会锁住操作。
export function surfaceSaveReason({
  hasSource,
  mode,
  paintStatus,
  previewBusy,
  previewError,
  name,
  busy,
}) {
  if (busy) return "正在保存…";
  if (
    mode === "draw" &&
    ["loading", "pending", "syncing"].includes(paintStatus)
  )
    return "正在同步画布…";
  if (mode === "draw" && paintStatus === "failed")
    return "画布同步失败，请重试";
  if (!hasSource)
    return mode === "ai" ? "生成材质后即可保存" : "创建或选择材质后即可保存";
  if (!name.trim()) return "请填写材质名称";
  if (previewBusy) return "正在更新预览…";
  if (previewError) return "预览失败，请重试";
  return "";
}
