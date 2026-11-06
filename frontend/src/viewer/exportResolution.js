// 导出像素独立于窗口尺寸；保留当前构图比例，尊重显卡纹理上限。
export function exportPixelRatio(
  width,
  height,
  requested = 2048,
  maxTextureSize = 4096,
) {
  const edge = Math.max(1, width, height);
  const target = Math.min(
    Math.max(512, requested || 2048),
    4096,
    maxTextureSize,
  );
  return target / edge;
}
