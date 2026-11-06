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

// 主操作与禁用原因共用，避免按钮写“保存”却没有可保存的修改。
export function editorPrimaryAction({
  draft,
  reviewing,
  acknowledged,
  busy,
  proposalPreview,
  issues = [],
  name = "",
  drawing,
  pendingDelete,
  openingKind,
  placement,
}) {
  const reason = proposalPreview
    ? "请先应用或退出建议预览"
    : placement
      ? "请先确认或取消放置"
      : drawing
        ? "请先完成或取消绘制"
        : pendingDelete
          ? "请先确认或取消删除"
          : openingKind
            ? "请先完成或取消门窗添加"
            : reviewing && !acknowledged
              ? "请先核对墙体和门窗"
              : (reviewing || draft.dirty) && issues.length
                ? "请先处理布局问题"
                : (reviewing || draft.dirty) && !name.trim()
                  ? "请填写版本名称"
                  : "";
  const preview = !reviewing && !draft.dirty;
  return {
    preview,
    disabled: busy || !!reason,
    label: busy
      ? "正在提交…"
      : reason ||
        (reviewing
          ? "确认修改并继续生成"
          : preview
            ? "查看三维效果"
            : "生成最新三维效果"),
    detail:
      reason ||
      (reviewing
        ? "对照原图核对结构后继续。"
        : preview
          ? "当前设计与三维成果一致，可直接查看。"
          : "修改自动保存；生成后更新完整预览和导出成果。"),
  };
}

// 返回完整预览时，默认接着生成当前修改；结构核对的返回不会代替人工确认。
export function editorReturnAction(state) {
  if (state.reviewing)
    return {
      preview: true,
      disabled: !!state.busy,
      label: "返回结构核对",
      detail: "保留草稿，返回结构核对。",
    };
  const action = editorPrimaryAction(state);
  return {
    ...action,
    label: state.busy
      ? "正在提交…"
      : state.draft.dirty
        ? "更新并预览"
        : "返回预览",
  };
}
