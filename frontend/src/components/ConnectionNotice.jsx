import { useEffect, useState } from "react";
import { checkConnection } from "../connectionGuard.js";
import "./connectionNotice.css";

export default function ConnectionNotice({ serviceError = "", onRetry }) {
  const [detected, setIssue] = useState(null);
  const [retry, setRetry] = useState(0);
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState("");
  useEffect(() => {
    let live = true,
      running = false,
      controller;
    const check = async () => {
      if (running || document.hidden) return;
      running = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      setChecking(true);
      try {
        await checkConnection({ signal: controller.signal, force: true });
        if (live) {
          setIssue(null);
          if (!serviceError) setDismissed("");
        }
      } catch (error) {
        if (live)
          setIssue({
            code: error.code || "unavailable",
            message: error.code
              ? error.message
              : "暂时无法连接工作台服务，请启动工作台后重新检测。",
          });
      } finally {
        clearTimeout(timeout);
        running = false;
        if (live) setChecking(false);
      }
    };
    check();
    const interval = setInterval(check, 30000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    return () => {
      live = false;
      controller?.abort();
      clearInterval(interval);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
    };
  }, [retry, serviceError]);
  const issue =
    detected ||
    (serviceError ? { code: "tasks", message: serviceError } : null);
  const issueKey = issue ? `${issue.code}:${issue.message}` : "";
  if (!issue || dismissed === issueKey) return null;
  return (
    <aside
      className="connection-notice"
      role="alert"
      aria-label="工作台连接检查"
    >
      <div>
        <strong>{issue.message}</strong>
        {issue.code === "origin" ? (
          <p>
            可先修复配置再重试；如需换入口，请先备份未同步的修改，浏览器草稿不会跨端口迁移。
          </p>
        ) : (
          issue.code !== "tasks" && (
            <p>
              请双击项目里的「启动工作台」后重试。使用 DeepSeek API
              也需要工作台运行，以保存任务和生成三维。当前页面的编辑内容会保留，请勿直接刷新。
            </p>
          )
        )}
      </div>
      <button
        disabled={checking}
        onClick={() => {
          onRetry?.();
          setRetry((value) => value + 1);
        }}
      >
        {checking ? "检测中…" : "重新检测"}
      </button>
      {issue.code === "origin" && (
        <a
          href={`http://127.0.0.1:8000/${location.search}${location.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          在新页面打开工作台
        </a>
      )}
      <button aria-label="关闭连接提示" onClick={() => setDismissed(issueKey)}>
        ×
      </button>
    </aside>
  );
}
