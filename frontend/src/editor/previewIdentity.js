// 名称、说明及编辑器元数据不改变可见几何；仍随草稿保存和正式导出。
// 只消除浮点尾差（米制数据保留 9 位小数），不修改保存数据或吞掉毫米级编辑。
export const previewNumber = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? Number(value.toFixed(9))
    : value;

export function previewKey(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .filter(
            (key) =>
              ![
                "edit_id",
                "edit_locked",
                "edit_group",
                "name",
                "title",
                "confidence",
                "scale_note",
                "warnings",
                "notes",
              ].includes(key),
          )
          .map((key) => [key, normalize(item[key])]),
      );
    return previewNumber(item);
  };
  return JSON.stringify(normalize(value));
}

export function previewFeedback(phase, hasContent, fallback = false) {
  if (phase === "error") return { label: "同步失败" };
  if (phase === "ready") return { label: "已同步" };
  return hasContent
    ? {
        label: fallback ? "已显示保存版本 · 同步修改中" : "细节更新中",
      }
    : { label: "加载中…" };
}
