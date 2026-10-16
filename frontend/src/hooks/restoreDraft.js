import { mergeDraft } from "./mergeDraft.js";

// 不用客户端时钟判定覆盖权。已同步基线用于三方合并，冲突保留两个版本。
export function restoreDraft(local, remote, original) {
  if (!local?.document)
    return { document: remote?.document || original, conflict: false };
  if (!remote?.document) return { document: local.document, conflict: false };
  if (local.baseDocument) {
    const merged = mergeDraft(
      local.baseDocument,
      local.document,
      remote.document,
    );
    return {
      document: merged.conflicts.length ? local.document : merged.document,
      conflict: !!merged.conflicts.length,
    };
  }
  const same =
    JSON.stringify(local.document) === JSON.stringify(remote.document);
  return { document: same ? remote.document : local.document, conflict: !same };
}
