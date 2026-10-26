export class ConnectionGuardError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    // Temporary environment problems must not permanently block draft retries.
    this.status = 503;
  }
}

async function probeConnection({ signal, origin }) {
  let response, body;
  try {
    response = await fetch(
      `/api/client-access?origin=${encodeURIComponent(origin || "")}`,
      {
        signal,
        cache: "no-store",
      },
    );
    body = await response.json();
  } catch (error) {
    if (signal?.aborted)
      throw new ConnectionGuardError(
        "连接检测超时，请稍后重试。",
        "unavailable",
      );
    throw new ConnectionGuardError("暂时无法连接工作台服务。", "unavailable");
  }
  if (
    !response.ok ||
    body?.application !== "layoutsculpt" ||
    body?.protocol !== 1 ||
    body?.origin !== origin
  ) {
    throw new ConnectionGuardError(
      "服务版本或连接不匹配，暂时无法提交。请重启本项目后重试。",
      "service",
    );
  }
  if (body.write_allowed !== true) {
    throw new ConnectionGuardError(
      "当前页面端口与服务配置不一致，暂时无法保存。请统一配置并重启，或打开工作台入口。",
      "origin",
    );
  }
  return body;
}

const checks = new Map();
const VALID_FOR_MS = 15000;
export function invalidateConnection() {
  checks.clear();
}

// Cancelling a preview only cancels that caller's wait, not a shared check.
function waitForCheck(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted)
    return Promise.reject(
      signal.reason || new DOMException("Aborted", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export function checkConnection({
  signal,
  origin = globalThis.location?.origin || "",
  force = false,
} = {}) {
  if (signal?.aborted)
    return Promise.reject(
      signal.reason || new DOMException("Aborted", "AbortError"),
    );
  const previous = checks.get(origin);
  if (previous?.pending) return waitForCheck(previous.pending, signal);
  if (!force && previous?.expires > Date.now())
    return Promise.resolve(previous.body);
  const entry = {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  entry.pending = probeConnection({ origin, signal: controller.signal })
    .then((body) => {
      if (checks.get(origin) === entry) {
        entry.body = body;
        entry.expires = Date.now() + VALID_FOR_MS;
      }
      return body;
    })
    .catch((error) => {
      if (checks.get(origin) === entry) checks.delete(origin);
      throw error;
    })
    .finally(() => {
      clearTimeout(timer);
      entry.pending = null;
    });
  checks.set(origin, entry);
  return waitForCheck(entry.pending, signal);
}

globalThis.addEventListener?.("online", invalidateConnection);
globalThis.addEventListener?.("offline", invalidateConnection);

export async function guardedFetch(url, options = {}) {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(
      (options.method || "GET").toUpperCase(),
    )
  ) {
    await checkConnection({ signal: options.signal });
  }
  try {
    const response = await fetch(url, options);
    if (
      [401, 403, 404, 405].includes(response.status) ||
      response.status >= 500
    )
      invalidateConnection();
    return response;
  } catch (error) {
    if (!options.signal?.aborted) invalidateConnection();
    throw error;
  }
}
