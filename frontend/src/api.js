export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, options);
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
  return response.json();
}
export const terminal = (status) =>
  ["succeeded", "failed", "cancelled"].includes(status);
