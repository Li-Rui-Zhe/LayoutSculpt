import { guardedFetch } from "./connectionGuard.js";
import { apiErrorMessage } from "./apiErrors.js";

// 先确认服务端完成打包和传输，才把文件交给浏览器；不宣称已写入磁盘。
export async function downloadFile(path, filename, { signal } = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, 120000);
  try {
    const response = await guardedFetch(path, { signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Error(apiErrorMessage(body.detail, response.status));
    }
    const blob = await response.blob();
    if (controller.signal.aborted) throw Error("下载已取消，设计仍保留。");
    if (!blob.size) throw Error("成果包内容为空，请重新准备。");
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (error) {
    if (controller.signal.aborted)
      throw Error("下载等待超时或已取消，原设计仍保留，可以重试。");
    if (error instanceof TypeError)
      throw Error("下载连接中断，原设计仍保留，请重试。");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
