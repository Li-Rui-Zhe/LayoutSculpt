// 多个 effect、控件事件共享一帧绘制；首次模型就绪可显式立即绘制。
export function createFrameRenderer(draw) {
  let frame = null;
  let closed = false;
  const cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  const flush = () => {
    cancel();
    if (!closed) draw();
  };
  return {
    request() {
      if (!closed && frame === null) frame = requestAnimationFrame(flush);
    },
    flush,
    close() {
      closed = true;
      cancel();
    },
  };
}
