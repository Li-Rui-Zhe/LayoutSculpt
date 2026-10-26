// 服务端暂未提供建模百分比；分阶段估算，只有模型就绪才返回 100。
export function previewProgress(phase, elapsed = 0) {
  const seconds = Math.max(0, elapsed) / 1000;
  switch (phase) {
    case "pending":
      return 5;
    case "building":
      return 12 + 64 * (1 - Math.exp(-seconds / 5));
    case "downloading":
      return 80 + 8 * (1 - Math.exp(-seconds / 2));
    case "loading":
      return 91 + 7 * (1 - Math.exp(-seconds / 2));
    case "ready":
      return 100;
    default:
      return 0;
  }
}

export const previewStages = {
  pending: "准备同步",
  building: "生成精细模型",
  downloading: "接收模型",
  loading: "载入材质与场景",
  ready: "三维已同步",
};
