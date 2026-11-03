const groups = [
  ["rooms", "空间"],
  ["walls", "墙体"],
  ["openings", "门窗与通道"],
  ["furniture", "家具"],
  ["lights", "灯具"],
  ["presentation_layers", "展示陈设"],
];
const labels = {
  x: "位置",
  y: "位置",
  elevation: "离地高度",
  rotation: "朝向",
  width: "宽度",
  depth: "进深",
  height: "高度",
  name: "名称",
  kind: "类型",
  polygon: "边界",
  start: "端点",
  end: "端点",
  offset: "安装位置",
  bottom: "离地高度",
  wall_id: "所属墙体",
  room_id: "所属空间",
  asset_id: "款式",
  floor_material: "地板",
  wall_material: "墙面",
  material_left: "A 面",
  material_right: "B 面",
  angle: "开门角度",
  parent_furniture_id: "联动关系",
  visible: "显示",
  edit_hidden: "显示",
};
const normalize = (value) => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => !["edit_group", "edit_locked", "edit_id"].includes(k))
        .map((k) => [k, normalize(value[k])]),
    );
  return typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value;
};
export function versionChanges(before, after) {
  const changes = [];
  for (const [key, label] of groups) {
    const a = before[key] || [],
      b = after[key] || [];
    const identity = (item, i) => item.id || item.edit_id || `${key}-${i}`;
    const old = new Map(a.map((item, i) => [identity(item, i), item]));
    const fresh = new Map(b.map((item, i) => [identity(item, i), item]));
    for (const [id, item] of fresh) {
      const prior = old.get(id),
        name = item.name || `${label} ${b.indexOf(item) + 1}`;
      if (!prior) {
        changes.push({ name, category: label, action: "新增", fields: [] });
        continue;
      }
      const fields = [
        ...new Set([...Object.keys(prior), ...Object.keys(item)]),
      ].filter(
        (k) =>
          !["edit_id", "edit_group", "edit_locked"].includes(k) &&
          JSON.stringify(normalize(prior[k] ?? null)) !==
            JSON.stringify(normalize(item[k] ?? null)),
      );
      if (fields.length)
        changes.push({
          name,
          category: label,
          action: "修改",
          fields: [...new Set(fields.map((k) => labels[k] || "其他属性"))],
        });
    }
    for (const [id, item] of old)
      if (!fresh.has(id))
        changes.push({
          name: item.name || label,
          category: label,
          action: "移除",
          fields: [],
        });
  }
  return changes;
}
