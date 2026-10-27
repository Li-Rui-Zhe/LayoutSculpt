// 建模服务暂不返回实际百分比，null 交由组件展示阶段估算；只有场景就绪才确认 100%。
export function previewProgress(phase) {
  return phase === "ready" ? 100 : null;
}

export const previewStages = {
  pending: "准备同步",
  building: "生成精细模型",
  downloading: "接收模型",
  loading: "载入材质与场景",
  ready: "三维已同步",
};
