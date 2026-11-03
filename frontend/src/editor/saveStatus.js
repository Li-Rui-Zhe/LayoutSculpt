export function editorSaveStatus(draft, proposalPreview = false) {
  if (proposalPreview)
    return { kind: "preview", text: "建议预览中 · 应用后才会保存" };
  const model = draft.dirty ? "三维版本待更新" : "与三维版本一致";
  if (draft.storageError)
    return { kind: "warning", text: `草稿保存需处理 · ${model}` };
  if (draft.syncPhase === "saved")
    return { kind: "saved", text: `草稿已保存到本机 · ${model}` };
  if (draft.syncPhase === "offline")
    return { kind: "warning", text: `等待恢复同步 · ${model}` };
  return { kind: "pending", text: `草稿保存中 · ${model}` };
}
