import { useEffect, useState } from "react";

export default function BuildNotice() {
  const [version, setVersion] = useState("");
  const [dismissed, setDismissed] = useState("");
  useEffect(() => {
    const current = document
      .querySelector('script[type="module"][src*="/assets/index-"]')
      ?.getAttribute("src");
    if (!current) return; // 开发环境由 Vite 更新。
    let running = false,
      alive = true,
      controller;
    const check = async () => {
      if (running || document.hidden) return;
      running = true;
      controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch("/", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const page = new DOMParser().parseFromString(
          await response.text(),
          "text/html",
        );
        const latest = page
          .querySelector('script[type="module"][src*="/assets/index-"]')
          ?.getAttribute("src");
        if (alive) setVersion(latest && latest !== current ? latest : "");
      } catch {
        /* 连接异常由统一连接提示处理。 */
      } finally {
        clearTimeout(timer);
        running = false;
      }
    };
    void check();
    const timer = setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, []);
  if (!version || version === dismissed) return null;
  return (
    <aside className="connection-notice" role="status" aria-label="工作台更新">
      <div>
        <strong>新版已就绪</strong>
        <p>请先保存当前设计，再刷新使用新功能。</p>
      </div>
      <button onClick={() => location.reload()}>我已保存，刷新</button>
      <button aria-label="稍后更新" onClick={() => setDismissed(version)}>
        ×
      </button>
    </aside>
  );
}
