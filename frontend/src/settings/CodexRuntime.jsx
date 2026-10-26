import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Download,
} from "lucide-react";
import { api } from "../api.js";
import CodexInstall from "./CodexInstall.jsx";

const authLabels = {
  configured: "已有本机认证",
  not_required: "使用自定义服务认证",
  required: "需要登录",
  unknown: "尚未确认",
};
const statusLabels = {
  unchecked: "待检测",
  ready: "检测通过",
  error: "需要处理",
  no_models: "暂无模型",
  restart_required: "需要重连",
  disconnected: "连接已断开",
};

function localTime(value) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "尚未检测";
}

export default function CodexRuntime({
  initial,
  busy,
  onPhase,
  onResult,
  onAlternative,
}) {
  const [report, setReport] = useState(initial);
  const [operation, setOperation] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const request = useRef(null);
  const sequence = useRef(0);
  useEffect(() => {
    setReport(initial);
  }, [initial]);
  useEffect(
    () => () => {
      ++sequence.current;
      request.current?.abort();
    },
    [],
  );

  const run = async (action) => {
    const current = ++sequence.current;
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
      if (current !== sequence.current) return;
      const diagnostics = value.diagnostics || value;
      setReport(diagnostics);
      // An update lookup alone must not clear a manually selected model.
      onResult(value.catalog, diagnostics, action !== "updates");
    } catch (e) {
      if (current === sequence.current) {
        setError(e.message);
        if (action !== "updates") onResult(null, null, true);
      }
    } finally {
      if (current === sequence.current) {
        setOperation("");
        onPhase("idle");
      }
    }
  };
  const cancel = () => {
    ++sequence.current;
    request.current?.abort();
    setOperation("");
    onPhase("idle");
    setError(
      "已停止等待检测结果。正在运行的设计任务和默认来源保持原设置，可重新检测状态。",
    );
  };
  const copy = async (command) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
    } catch {
      setError("无法自动复制，请选中下方命令手动复制。");
    }
  };
  const update = report?.update;
  const ready = report?.status === "ready";
  const commands =
    report?.action === "login" ? [["终端登录", "codex login"]] : [];

  return (
    <div
      className="ai-runtime"
      aria-label="Codex CLI 运行环境"
      aria-busy={!!operation}
    >
      <div className="ai-runtime-title">
        <div>
          <Activity size={17} />
          <h3>本机 Codex CLI</h3>
        </div>
        <span className={`ai-runtime-badge ${ready ? "ready" : ""}`}>
          {ready ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
          {statusLabels[report?.status] || "待检测"}
        </span>
      </div>
      <p className="ai-field-help">
        沿用本机 CLI 的登录与配置，检测仅验证连接和模型目录。
      </p>
      <dl className="ai-runtime-facts">
        <div>
          <dt>当前安装版本</dt>
          <dd>{report?.version || "待检测"}</dd>
        </div>
        <div>
          <dt>运行平台</dt>
          <dd>
            {[
              report?.platform,
              report?.architecture_label ||
                {
                  AMD64: "x64（64 位）",
                  x86_64: "x64（64 位）",
                  aarch64: "ARM64",
                  arm64: "ARM64",
                }[report?.architecture] ||
                report?.architecture,
            ]
              .filter(Boolean)
              .join(" · ") || "待检测"}
          </dd>
        </div>
        <div>
          <dt>认证状态</dt>
          <dd>{authLabels[report?.auth_status] || authLabels.unknown}</dd>
        </div>
        <div>
          <dt>最近检测</dt>
          <dd>{localTime(report?.checked_at)}</dd>
        </div>
      </dl>
      <div
        className={`ai-runtime-message ${ready ? "ready" : ""}`}
        role="status"
      >
        {report?.message || "先检测环境，确认本机 CLI 可以连接。"}
        {report?.retry_count > 0 && <small>临时连接故障已自动重试一次。</small>}
        {report?.history_warning && <small>{report.history_warning}</small>}
      </div>
      <div className="ai-runtime-actions">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => run("check")}
        >
          {operation === "check" ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Activity size={14} />
          )}
          {operation === "check" ? "正在检测…" : "检测环境并读取模型"}
        </button>
        <button
          className="ai-text-button"
          disabled={busy || report?.active_tasks > 0}
          onClick={() => run("reconnect")}
        >
          {operation === "reconnect" ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          {operation === "reconnect" ? "正在重连…" : "安全重连"}
        </button>
        {operation === "check" && (
          <button className="ai-text-button" onClick={cancel}>
            取消等待
          </button>
        )}
      </div>
      <small className="ai-runtime-note">
        安全重连仅重启本项目的 CLI 连接；有任务运行时会拒绝重连。
      </small>
      {error && (
        <p className="ai-feedback error" role="alert">
          {error}
        </p>
      )}
      {onAlternative &&
        ["error", "no_models", "restart_required", "disconnected"].includes(
          report?.status,
        ) && (
          <div className="ai-runtime-fallback">
            <p>
              也可以检查已配置的 DeepSeek
              备用连接。保存为默认后，新任务才会使用它。
            </p>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={onAlternative}
            >
              检查 DeepSeek 备用连接
            </button>
          </div>
        )}
      {commands.map(([label, command]) => (
        <div className="ai-runtime-command" key={command}>
          <span>{label}</span>
          <code>{command}</code>
          <button
            type="button"
            aria-label={`复制${label}命令`}
            onClick={() => copy(command)}
          >
            <Copy size={13} />
            {copied === command ? "已复制" : "复制"}
          </button>
        </div>
      ))}
      <div className="ai-runtime-update">
        <div className="ai-runtime-update-heading">
          <strong>
            <Download size={14} />
            版本更新
          </strong>
          <button
            className="ai-text-button"
            disabled={busy}
            onClick={() => run("updates")}
          >
            {operation === "updates" && (
              <LoaderCircle size={13} className="spin" />
            )}
            {operation === "updates" ? "正在查询…" : "检查更新"}
          </button>
        </div>
        <p>
          {update?.status === "ok"
            ? update.available === true
              ? `有新版本 ${update.latest_version}，可在当前页面下载安装并自动重连。`
              : update.available === false
                ? `npm 稳定版为 ${update.latest_version}，当前安装版本无需升级。`
                : `npm 稳定版为 ${update.latest_version}；检测本机版本后可进行比较。`
            : update?.message || "按需查询官方 npm 包的稳定版本。"}
        </p>
        {update?.checked_at && (
          <small>查询时间：{localTime(update.checked_at)} · 结果短时缓存</small>
        )}
        <CodexInstall
          disabled={busy}
          update={update}
          onBusy={(active) =>
            onPhase(
              active
                ? "installing"
                : (current) => (current === "installing" ? "idle" : current),
            )
          }
          onComplete={async (value) => {
            setReport(value.diagnostics);
            let catalog = null;
            if (
              value.job?.status === "succeeded" &&
              value.diagnostics?.status === "ready"
            ) {
              onPhase("checking");
              try {
                catalog = await api("/models?provider=codex&refresh=true");
              } catch (e) {
                setError(e.message);
              } finally {
                onPhase("idle");
              }
            }
            onResult(
              catalog,
              value.diagnostics,
              value.job?.status === "succeeded",
            );
          }}
        />
        <details>
          <summary>查看手动升级方法</summary>
          <p>也可以使用原来的安装方式升级，完成后点击「安全重连」重新检测。</p>
          {[
            ["npm 安装", "npm install -g @openai/codex@latest"],
            ...(report?.platform === "Darwin"
              ? [["Homebrew 安装", "brew upgrade --cask codex"]]
              : []),
          ].map(([label, command]) => (
            <div className="ai-runtime-command" key={command}>
              <span>{label}</span>
              <code>{command}</code>
              <button
                type="button"
                aria-label={`复制${label}升级命令`}
                onClick={() => copy(command)}
              >
                <Copy size={13} />
                {copied === command ? "已复制" : "复制"}
              </button>
            </div>
          ))}
          <p>
            手动安装请查看官方说明。如果新版本检测失败，可通过原安装工具恢复之前的版本，再重新检测。
          </p>
          {report?.last_verified && (
            <p>
              本机最近通过协议检测：{report.last_verified.version} ·{" "}
              {localTime(report.last_verified.checked_at)}
              。这不代表该版本已在所有系统或模型上完成验证。
            </p>
          )}
          <a
            href={report?.docs_url || "https://developers.openai.com/codex/cli"}
            target="_blank"
            rel="noreferrer"
          >
            官方安装说明 <ExternalLink size={12} />
          </a>
        </details>
      </div>
    </div>
  );
}
