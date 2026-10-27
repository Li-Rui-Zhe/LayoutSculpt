// 编辑器的选择/锁定元数据不影响模型；隐藏状态和所有实际设计参数仍参与比较。
export function previewKey(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .filter(
            (key) => !["edit_id", "edit_locked", "edit_group"].includes(key),
          )
          .map((key) => [key, normalize(item[key])]),
      );
    return item;
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
