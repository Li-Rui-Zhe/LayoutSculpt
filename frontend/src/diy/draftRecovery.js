import { restoreDraft } from "../hooks/restoreDraft.js";

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

// 恢复与普通编辑使用同一锁定规则；写入恢复缓存前先检查。
export function lockedPartChange(current, next) {
  const stable = (part) =>
    Object.fromEntries(
      Object.entries(part).filter(
        ([key]) => !["edit_locked", "edit_hidden"].includes(key),
      ),
    );
  return (current?.parts || []).some((part) => {
    if (!part.edit_locked) return false;
    const after = next?.parts.find((p) => p.id === part.id);
    return !after || !sameDesign(stable(part), stable(after));
  });
}

export function reconnectDiyDraft(
  current,
  remote,
  base,
  alternative,
  canReplace = true,
  pendingInput = false,
) {
  const choice = restoreDraft(
    current ? { document: current, baseDocument: base } : null,
    remote,
    current,
  );
  const changed = !sameDesign(choice.document, current);
  const cachedConflict = alternative && !sameDesign(alternative, current);
  const needsChoice =
    cachedConflict ||
    choice.conflict ||
    (changed && (!canReplace || pendingInput));
  return {
    document: needsChoice ? current : choice.document,
    alternative: needsChoice
      ? cachedConflict
        ? alternative
        : choice.conflict
          ? remote.document
          : choice.document
      : null,
    // 未经选择的远端版本不是同步基线，否则刷新会误以为冲突已经解决。
    baseDocument: needsChoice ? base : remote.document || null,
  };
}
