// 对象字段的排列顺序不代表内容变化；部件数组顺序仍有意义。
export function sameDesign(a, b) {
  const stable = (v) => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((key) => [key, stable(v[key])]),
      );
    return v;
  };
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

export function draftRecoveryAction(
  current,
  saved,
  untouched = true,
  baseline = null,
) {
  if (!saved || sameDesign(current, saved)) return "none";
  if (untouched && (!current || sameDesign(current, baseline)))
    return "restore";
  return "choose";
}
