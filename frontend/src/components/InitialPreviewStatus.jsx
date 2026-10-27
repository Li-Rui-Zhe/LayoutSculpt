import { TriangleAlert } from "lucide-react";
import TaskProgress from "./TaskProgress.jsx";
import { generationError } from "../hooks/modelSelection.js";
import "./initialPreviewStatus.css";

// 初稿可见不代表任务结束；状态来自任务本身，不以模型加载完成替代生成完成。
export default function InitialPreviewStatus({
  job,
  events = [],
  connectionError,
  busy,
  error,
  onContinue,
  onTimeline,
  onSource,
}) {
  if (job.status === "succeeded") return null;
  const active = ["queued", "running"].includes(job.status);
  const stopped = ["failed", "cancelled"].includes(job.status);
  const latest = [...events]
    .reverse()
    .find(
      (event) =>
        event.job_id === job.id &&
        event.status === job.status &&
        event.stage === job.stage &&
        event.message,
    );
  return (
    <section
      className="initial-preview-status"
      aria-label="三维初稿生成状态"
      data-active={active && !connectionError}
    >
      <header>
        <strong>
          <TriangleAlert size={15} />
          三维初稿 · 尚未人工核对
        </strong>
        <div>
          <button className="text-button" onClick={onTimeline}>
            查看进展
          </button>
          <button className="text-button" onClick={onSource}>
            对照原图
          </button>
        </div>
      </header>
      {active ? (
        <>
          <TaskProgress job={job} />
          <p className="initial-preview-event" role="status">
            {connectionError ||
              generationError(latest?.message) ||
              "任务正在后台处理，阶段完成后进度会更新。"}
          </p>
          <p className="initial-preview-help">
            {connectionError
              ? "当前初稿已保留，连接恢复后自动同步进展，请勿重复提交。"
              : "正在自动继续，无需确认。进度按阶段更新；可先旋转查看，完成后可编辑。"}
          </p>
        </>
      ) : (
        <>
          <p className="initial-preview-event" role="status">
            {job.status === "cancelled"
              ? "生成已取消，已完成的空间初稿仍保留。"
              : generationError(job.error) ||
                "生成暂未完成，已完成的空间初稿仍保留。"}
          </p>
          {stopped && (
            <button
              className="secondary-button"
              disabled={busy || !!connectionError}
              onClick={onContinue}
            >
              {busy ? "正在继续…" : "继续生成"}
            </button>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
