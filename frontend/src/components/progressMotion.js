export const PROGRESS_FINISH_MS = 520;
export const PROGRESS_HOLD_MS = 280;
export const PROGRESS_FADE_MS = 160;

// 数字与填充条共用同一个值；未完成时不因插值到达 100%。
export function progressTween(from, target, elapsed, duration) {
  const end = Math.max(from, Math.min(100, target));
  const t = Math.max(0, Math.min(1, elapsed / duration));
  return from + (end - from) * (1 - (1 - t) ** 3);
}
