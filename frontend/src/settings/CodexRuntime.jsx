import { useEffect, useRef, useState } from "react";
import {
  Monitor,
  CheckCircle2,
  LoaderCircle,
  ExternalLink,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { api } from "../api.js";
import CodexInstall from "./CodexInstall.jsx";

export default function CodexRuntime({
  initial,
  connection,
  busy,
  onPhase,
  onResult,
  onEnvironment,
  onConnect,
  onAlternative,
}) {
  const [report, setReport] = useState(initial);
  const [operation, setOperation] = useState("");
  const [error, setError] = useState("");
  const [login, setLogin] = useState({ status: "idle" });
  const request = useRef(null),
    sequence = useRef(0),
    alive = useRef(true);
  const callbacks = useRef({ onPhase, onResult, onEnvironment, onConnect });
  callbacks.current = { onPhase, onResult, onEnvironment, onConnect };
  useEffect(() => {
    setReport(initial);
  }, [initial]);
  useEffect(() => {
    alive.current = true;
    api("/ai/codex/login")
      .then((value) => {
        if (alive.current && value.status === "waiting") {
          setLogin(value);
          callbacks.current.onPhase("login");
        }
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      ++sequence.current;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (login.status !== "waiting") return;
    let active = true,
      timer,
      controller;
    const poll = async () => {
      controller = new AbortController();
      try {
        const value = await api("/ai/codex/login", {
          signal: controller.signal,
        });
        if (!active) return;
        setLogin(value);
        setError("");
        if (value.status !== "waiting") {
          callbacks.current.onPhase("idle");
          if (value.status === "succeeded") await callbacks.current.onConnect();
          return;
        }
      } catch (e) {
        if (active) setError("暂时未读到登录结果，正在重试；无需重复登录。");
      }
      if (active) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [login.status]);
  const run = async (action) => {
    const token = ++sequence.current;
    const controller = new AbortController();
    request.current = controller;
    setOperation(action);
    setError("");
    onPhase("checking");
    try {
      const value = await api(`/ai/codex/${action}`, {
        method: "POST",
        signal: controller.signal,
        timeoutMs: 65000,
      });
      if (token !== sequence.current) return;
      const diagnostics = value.diagnostics || value;
      setReport(diagnostics);
      onResult(value.catalog, diagnostics, action !== "updates");
    } catch (e) {
      if (token === sequence.current) setError(e.message);
    } finally {
      if (token === sequence.current) {
        setOperation("");
        onPhase("idle");
      }
    }
  };
  const startLogin = async () => {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setError("");
    onPhase("login");
    try {
      const value = await api("/ai/codex/login", {
        method: "POST",
        timeoutMs: 45000,
      });
      if (!alive.current) {
        popup?.close();
        return;
      }
      setLogin(value);
      if (value.url && popup) popup.location.href = value.url;
      else popup?.close();
    } catch (e) {
      popup?.close();
      if (alive.current) {
        setError(e.message);
        onPhase("idle");
      }
    }
  };
  const cancelLogin = async () => {
    try {
      const value = await api("/ai/codex/login/cancel", { method: "POST" });
      if (alive.current) {
        setLogin(value);
        onPhase("idle");
      }
    } catch (e) {
      if (alive.current) setError(e.message);
    }
  };
  const installed = async (value) => {
    if (!alive.current) return;
    setReport(value.diagnostics);
    onResult(null, value.diagnostics, true);
    try {
      await onEnvironment();
    } catch {
      setError("环境已处理，请刷新状态确认连接。");
    }
  };
  const ready = report?.status === "ready";
  const isolated = connection.environment === "isolated";
  const needLogin =
    report?.action === "login" || report?.code === "authentication";
  const installer = (
    <CodexInstall
      disabled={busy}
      update={report?.update}
      environment={connection.environment}
      onBusy={(active) =>
        onPhase(
          active
            ? "installing"
            : (current) => (current === "installing" ? "idle" : current),
        )
      }
      onComplete={installed}
    />
  );
  return (
    <div
      className="ai-runtime ai-runtime-simple"
      aria-label="Codex CLI 运行环境"
    >
      <div className="ai-codex-detected">
        <Monitor size={22} />
        <div>
          <strong>
            {isolated
              ? "使用项目独立环境"
              : connection.available
                ? connection.managed
                  ? "使用项目 CLI · 沿用本机配置"
                  : "已发现本机 Codex"
                : "尚未发现可用的 Codex"}
          </strong>
          <p>
            {isolated
              ? "程序、配置和登录由本项目单独管理。"
              : connection.available
                ? "可以直接连接，不必重新安装。本机更新配置或退出登录也会影响这里。"
                : "可以在下方一键准备独立环境；首次需要在官方页面登录。"}
          </p>
        </div>
        {ready && <CheckCircle2 size={18} />}
      </div>
      {report?.message && !ready && (
        <p className="ai-field-help">
          {needLogin ? "需要先登录，再读取可用模型。" : report.message}
        </p>
      )}
      {needLogin && login.status !== "waiting" && (
        <div className="ai-login-action">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={startLogin}
          >
            <ExternalLink size={15} />
            登录并连接 Codex
          </button>
          {!isolated && (
            <small>
              此操作使用本机共享登录；需要完全分开时，请使用下方独立环境。
            </small>
          )}
        </div>
      )}
      {login.status === "waiting" && (
        <div className="ai-login-wait" role="status">
          <LoaderCircle size={16} className="spin" />
          <div>
            <strong>等待官方页面登录</strong>
            <p>完成后自动检测并连接。浏览器没有打开时，可点击下方入口。</p>
            <a href={login.url} target="_blank" rel="noreferrer">
              前往官方登录 <ExternalLink size={12} />
            </a>
          </div>
          <button className="ai-text-button" onClick={cancelLogin}>
            取消登录
          </button>
        </div>
      )}
      {login.status === "failed" && (
        <p role="alert" className="ai-feedback error">
          {login.message}
        </p>
      )}
      {error && (
        <p className="ai-feedback error" role="alert">
          <AlertCircle size={15} />
          {error}
          <button aria-label="关闭 Codex 提示" onClick={() => setError("")}>
            ×
          </button>
        </p>
      )}
      {!connection.available && installer}
      <details className="ai-advanced">
        <summary>环境、更新与恢复</summary>
        <dl className="ai-runtime-facts">
          <div>
            <dt>当前版本</dt>
            <dd>{report?.version || "连接后检测"}</dd>
          </div>
          <div>
            <dt>配置方式</dt>
            <dd>{isolated ? "项目独立" : "复用本机"}</dd>
          </div>
        </dl>
        <div className="ai-runtime-actions">
          <button
            className="ai-text-button"
            disabled={busy}
            onClick={() => run("check")}
          >
            {operation === "check" ? "正在检测…" : "检查连接"}
          </button>
          <button
            className="ai-text-button"
            disabled={busy || report?.active_tasks > 0}
            onClick={() => run("reconnect")}
          >
            <RefreshCw size={13} />
            重新连接
          </button>
          <button
            className="ai-text-button"
            disabled={busy}
            onClick={() => run("updates")}
          >
            {operation === "updates" ? "正在检查…" : "检查更新"}
          </button>
        </div>
        {report?.update && (
          <p className="ai-field-help">
            {report.update.status === "ok"
              ? `官方稳定版本：${report.update.latest_version}${report.update.available ? "，可按需更新。" : "。"}`
              : report.update.message}
          </p>
        )}
        {connection.available && installer}
        <p className="ai-field-help">
          更新先下载校验，等当前任务结束再启用；失败保留原版本。复用本机配置时不会自动复制登录信息到独立环境。
        </p>
      </details>
      {onAlternative && !ready && (
        <button
          className="ai-text-button"
          disabled={busy}
          onClick={onAlternative}
        >
          想简单一点？改用 DeepSeek API
        </button>
      )}
    </div>
  );
}
