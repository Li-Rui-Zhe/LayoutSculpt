import { useEffect, useRef, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { progressTween, PROGRESS_FINISH_MS } from "./progressMotion.js";
import { useProgressLifecycle } from "./useProgressLifecycle.js";
import "./loadingProgress.css";

function useElapsed(key, active = true) {
  const [clock, setClock] = useState({ key, elapsed: 0 });
  useEffect(() => {
    setClock({ key, elapsed: 0 });
    if (!active) return;
    const started = performance.now();
    const timer = setInterval(
      () => setClock({ key, elapsed: performance.now() - started }),
      200,
    );
    return () => clearInterval(timer);
  }, [key, active]);
  return clock.key === key ? clock.elapsed : 0;
}

export function useSmoothProgress(target, key, complete) {
  const current = useRef({ key, value: target });
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (current.current.key !== key) {
      current.current = { key, value: target };
      setValue(target);
      return;
    }
    const from = current.current.value;
    if (target <= from) return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : complete
        ? PROGRESS_FINISH_MS
        : 200;
    const started = performance.now();
    let frame;
    const tick = (now) => {
      const next = duration
        ? progressTween(from, target, now - started, duration)
        : Math.max(from, target);
      current.current.value = next;
      setValue(next);
      if (now - started < duration) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, key, complete]);
  return current.current.key === key ? value : target;
}

// 无服务端百分比时明确展示预计进度；完成状态只能由调用方确认。
export function InlineProgress({
  active = true,
  failed = false,
  cancelled = false,
  operationKey,
  fallback = null,
}) {
  const lifecycle = useProgressLifecycle({
    active,
    failed,
    cancelled,
    operationKey,
    delay: 0,
  });
  const elapsed = useElapsed(lifecycle.run, !!active);
  const value = useSmoothProgress(
    lifecycle.complete ? 100 : 4 + 90 * (1 - Math.exp(-elapsed / 14000)),
    lifecycle.run,
    lifecycle.complete,
  );
  useEffect(() => {
    if (lifecycle.complete && value >= 100) lifecycle.settle();
  }, [lifecycle.complete, value, lifecycle.settle]);
  if (!lifecycle.visible) return fallback;
  return (
    <span
      className="loading-progress-inline"
      aria-hidden="true"
      title={
        lifecycle.complete && value >= 100
          ? "已完成"
          : `预计 ${Math.floor(value)}%`
      }
      data-settled={lifecycle.phase === "settled"}
      data-complete={lifecycle.complete && value >= 100}
    >
      <i style={{ width: `${value}%`, transition: "none" }} />
    </span>
  );
}

export default function LoadingProgress({
  label = "正在准备",
  detail,
  progress,
  steps,
  step = 0,
  complete = false,
  className = "",
  compact = false,
  estimateFrom = 4,
  estimateTo = 94,
  estimateKey = label,
  operationKey = estimateKey,
  onComplete,
  estimated = false,
}) {
  const [slow, setSlow] = useState(false);
  const known = Number.isFinite(progress);
  const elapsed = useElapsed(estimateKey, !known && !complete);
  useEffect(() => {
    setSlow(false);
    if (complete) return;
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [label, complete]);
  const target = complete
    ? 100
    : known
      ? Math.max(0, Math.min(99, progress))
      : estimateFrom +
        (estimateTo - estimateFrom) * (1 - Math.exp(-elapsed / 14000));
  const value = useSmoothProgress(target, operationKey, complete);
  const finished = complete && value >= 100;
  useEffect(() => {
    if (finished) onComplete?.();
  }, [finished, onComplete]);
  const Icon = finished ? Check : Sparkles;
  return (
    <div
      className={`loading-progress ${compact ? "is-compact" : ""} ${className}`}
      data-complete={finished}
      data-estimated={(estimated || !known) && !complete}
      aria-busy={!complete}
    >
      <div
        className="loading-progress-heading"
        role="status"
        aria-live="polite"
      >
        <Icon size={16} aria-hidden="true" />
        <strong>{label}</strong>
        <span>
          {finished
            ? "100% · 已完成"
            : `${!complete && (estimated || !known) ? "预计 " : ""}${Math.floor(value)}%`}
        </span>
      </div>
      <div
        className="loading-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(value)}
        aria-valuetext={`${(estimated || !known) && !complete ? "预计进度 " : ""}${Math.floor(value)}%`}
      >
        <span
          className="loading-progress-fill"
          style={{ width: `${value}%` }}
          data-smooth="true"
        />
      </div>
      {steps && (
        <div className="loading-progress-steps" aria-label="处理阶段">
          {steps.map((text, index) => (
            <span
              key={text}
              data-active={index === step}
              data-done={complete || index < step}
            >
              <i aria-hidden="true" />
              {text}
            </span>
          ))}
        </div>
      )}
      {detail && <p className="loading-progress-detail">{detail}</p>}
      {slow && !complete && (
        <small className="loading-progress-slow" role="status">
          这一步耗时稍长，完成后会自动更新。
        </small>
      )}
    </div>
  );
}
