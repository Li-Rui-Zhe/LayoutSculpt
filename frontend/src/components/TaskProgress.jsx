import { useEffect, useState } from "react";
import { useSmoothProgress } from "./LoadingProgress.jsx";
import { useProgressLifecycle } from "./useProgressLifecycle.js";

export default function TaskProgress({ job, compact = false }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (compact || !["queued", "running"].includes(job.status)) return;
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, [compact, job.status, job.id]);
  const silence = Math.max(
    0,
    Math.floor((now - Date.parse(job.updated_at)) / 1000),
  );
  const active = ["queued", "running", "awaiting_review"].includes(job.status);
  const failed = ["failed", "cancelled"].includes(job.status);
  const lifecycle = useProgressLifecycle({
    active,
    failed,
    operationKey: job.id,
    delay: 0,
  });
  const complete = job.status === "succeeded";
  const value = useSmoothProgress(
    complete ? 100 : Math.min(99, Math.max(0, job.progress || 0)),
    job.id,
    complete,
  );
  useEffect(() => {
    if (complete && value >= 100) lifecycle.settle();
  }, [complete, value, lifecycle.settle]);
  if (compact && !lifecycle.visible) return null;
  return (
    <div
      className={compact ? "task-card-progress" : "task-progress-display"}
      data-settled={compact && lifecycle.phase === "settled"}
    >
      {!compact && (
        <div className="task-progress-heading">
          <span>{job.stage}</span>
          <b title="按实际完成的步骤更新，不代表剩余时间">
            {Math.floor(value)}%
          </b>
        </div>
      )}
      <span
        className="progress-track"
        role="progressbar"
        aria-label="任务生成进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(value)}
      >
        <i style={{ width: `${value}%`, transition: "none" }} />
      </span>
      {compact && <small>{Math.floor(value)}%</small>}
      {!compact && ["queued", "running"].includes(job.status) && (
        <small className="field-note">
          按完成步骤更新进度
          {silence >= 30
            ? ` · 距上次进展 ${Math.floor(silence / 60) ? `${Math.floor(silence / 60)} 分 ` : ""}${silence % 60} 秒，仍在等待本阶段结果`
            : "，各阶段耗时不同"}
        </small>
      )}
    </div>
  );
}
