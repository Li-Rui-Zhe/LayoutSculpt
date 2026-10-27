import { InlineProgress } from "../components/LoadingProgress.jsx";
import OperationStatus from "../components/OperationStatus.jsx";
import { useEffect, useRef, useState } from "react";
import {
  Download,
  RefreshCw,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { api } from "../api.js";

const activeJob = (job) => ["queued", "running"].includes(job?.status);
const megabytes = (value) => `${(value / 1024 / 1024).toFixed(1)} MB`;
const cancellable = (job) =>
  activeJob(job) && !["activate", "reconnect", "restore"].includes(job.stage);

export default function CodexInstall({
  disabled,
  update,
  environment,
  onBusy,
  onComplete,
}) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const request = useRef(null);
  const timer = useRef(null);
  const alive = useRef(false);
  const seenJob = useRef(null);
  const sequence = useRef(0);
  const callbacks = useRef({ onBusy, onComplete });
  callbacks.current = { onBusy, onComplete };

  const accept = (value) => {
    if (!alive.current) return;
    setState(value);
    setError("");
    const running = activeJob(value.job);
    callbacks.current.onBusy(running);
    if (!running && seenJob.current && value.job?.id === seenJob.current) {
      seenJob.current = null;
      callbacks.current.onComplete(value);
    }
    if (running) {
      seenJob.current = value.job.id;
      clearTimeout(timer.current);
      timer.current = setTimeout(load, 1200);
    }
  };
  const load = async () => {
    const current = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const value = await api("/ai/codex/installation", {
        signal: controller.signal,
      });
      if (current === sequence.current) accept(value);
    } catch (e) {
      if (alive.current && current === sequence.current) {
        setError(`${e.message} 下载任务可能仍在后台进行，请重新读取状态。`);
        // A lost polling response is not evidence that the installer stopped.
        timer.current = setTimeout(load, 3000);
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      ++sequence.current;
      clearTimeout(timer.current);
      request.current?.abort();
    };
  }, []);
  const act = async (action) => {
    const current = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    clearTimeout(timer.current);
    setSending(true);
    setError("");
    callbacks.current.onBusy(true);
    try {
      const value = await api(
        action === "cancel" ? "/ai/codex/install/cancel" : "/ai/codex/install",
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          ...(action !== "cancel" ? { body: JSON.stringify({ action }) } : {}),
        },
      );
      if (current === sequence.current) accept(value);
    } catch (e) {
      if (alive.current && current === sequence.current) {
        setError(`${e.message} 请读取状态确认操作结果。`);
        // POST can succeed even when its response is lost; poll before retrying.
        if (!e.status) timer.current = setTimeout(load, 1000);
        else callbacks.current.onBusy(false);
      }
    } finally {
      if (alive.current) setSending(false);
    }
  };
  const job = state?.job;
  const running = activeJob(job);
  const locked = disabled || sending || loading || running || !!error;
  const progress = job?.total_bytes
    ? Math.min(100, Math.round((job.downloaded_bytes / job.total_bytes) * 100))
    : null;
  return (
    <div
      className="ai-cli-install"
      aria-label="Codex CLI 下载安装"
      aria-busy={running || sending}
    >
      <div className="ai-cli-install-heading">
        <div>
          <h4>项目管理</h4>
          <p>下载官方版本，校验后使用，无需手动填写路径。</p>
        </div>
        <span>{state?.managed ? "使用项目专用 CLI" : "当前使用本机 CLI"}</span>
      </div>
      <div className="ai-cli-install-actions">
        <button
          className="primary-button"
          disabled={locked}
          onClick={() => act(state?.managed ? "install" : "isolated")}
        >
          <InlineProgress
            active={running || sending}
            failed={job?.status === "failed" || (!running && !!error)}
            cancelled={job?.status === "cancelled"}
            fallback={<Download size={14} />}
          />
          {running
            ? "正在处理 CLI…"
            : update?.available === true
              ? `一键更新至 ${update.latest_version}`
              : state?.managed && update?.available === false
                ? "重新准备当前环境"
                : "准备项目独立环境"}
        </button>
        {state?.can_rollback && (
          <button
            className="secondary-button"
            disabled={locked}
            onClick={() => act("rollback")}
          >
            <RotateCcw size={13} />
            恢复上一版
          </button>
        )}
        {state?.can_use_system && (
          <button
            className="ai-text-button"
            disabled={locked}
            onClick={() => act("system")}
          >
            恢复原本机 CLI
          </button>
        )}
        {cancellable(job) && (
          <button
            className="ai-text-button"
            disabled={sending}
            onClick={() => act("cancel")}
          >
            取消下载 / 安装
          </button>
        )}
      </div>
      <p className="ai-cli-install-note">
        当前配置：
        {state?.environment === "isolated"
          ? "项目独立保存，首次需单独登录"
          : "沿用本机配置和登录"}
        。准备独立环境后，需完成登录才能使用；已有设计不会改变。
      </p>
      {state?.managed && state.environment !== "isolated" && (
        <button
          className="ai-text-button"
          disabled={locked}
          onClick={() => act("isolated")}
        >
          切换为项目独立环境（需重新登录）
        </button>
      )}
      {state?.install_dir && (
        <details className="ai-install-location">
          <summary>查看安装位置</summary>
          <p className="ai-cli-install-path">{state.install_dir}</p>
        </details>
      )}
      {job && (
        <div
          className={`ai-cli-job ${job.status}`}
          role="status"
          aria-live="polite"
        >
          <div>
            {!running && job.status === "succeeded" ? (
              <CheckCircle2 size={15} />
            ) : !running ? (
              <AlertCircle size={15} />
            ) : null}
            <strong>{job.message}</strong>
          </div>
          {job.downloaded_bytes != null && (
            <>
              <small>
                {megabytes(job.downloaded_bytes)}
                {job.total_bytes
                  ? ` / ${megabytes(job.total_bytes)} · 下载 ${progress}%`
                  : " · 正在下载"}
              </small>
            </>
          )}
          <OperationStatus
            active={running}
            failed={job.status === "failed"}
            cancelled={job.status === "cancelled"}
            operationKey={job.id}
            label={job.message}
            successLabel="CLI 已准备就绪"
            estimated
            estimateFrom={10}
            estimateTo={70}
            progress={
              job.stage === "download"
                ? progress == null
                  ? undefined
                  : 10 + progress * 0.6
                : ({
                    resolve: 5,
                    extract: 75,
                    verify: 85,
                    activate: 93,
                    reconnect: 97,
                    restore: 90,
                  }[job.stage] ?? 2)
            }
          />
          <ol aria-label="CLI 安装步骤">
            {(job.events || []).slice(-5).map((event, index) => (
              <li key={`${event.at}-${index}`}>{event.message}</li>
            ))}
          </ol>
        </div>
      )}
      {error && (
        <div className="ai-feedback error" role="alert">
          <span>{error}</span>
          <button disabled={sending} onClick={load}>
            <RefreshCw size={12} />
            读取状态
          </button>
        </div>
      )}
    </div>
  );
}
