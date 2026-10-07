export async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.method === "POST" ? 90000 : 15000,
  );
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) controller.abort();
  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        typeof body.detail === "string"
          ? body.detail
          : Array.isArray(body.detail)
            ? body.detail
                .map((error) => error.msg.replace(/^Value error, /, ""))
                .join("；")
            : `请求失败（${response.status}），请检查本地服务是否启动。`,
      );
    }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("请求等待超时或已取消，请先刷新任务列表确认状态。");
    if (error instanceof TypeError)
      throw new Error(
        "无法连接本地服务，请检查服务是否运行。任务数据仍保留在本机。",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
export const terminal = (status) =>
  ["succeeded", "failed", "cancelled"].includes(status);
