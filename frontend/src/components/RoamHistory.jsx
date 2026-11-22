import { useState } from "react";
import { ArrowLeft, ArrowUpRight, Box, History } from "lucide-react";
import LoadingProgress from "./LoadingProgress.jsx";
import Modal from "./Modal.jsx";

export const historyDate = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});
const imageStatus = {
  ready: "已生成",
  failed: "未完成",
  generating: "生成中",
  queued: "排队中",
};

function buildTasks(jobs, records, project) {
  const byProject = new Map();
  for (const item of records) {
    const id = item.context?.projectId;
    if (!id || item.archived || item.context.framing !== "panorama") continue;
    if (!byProject.has(id)) byProject.set(id, []);
    byProject.get(id).push(item);
  }
  const tasks = jobs
    .filter(
      (job) =>
        !job.archived &&
        (job.options?.furniture_mode === "basic" ||
          byProject.has(job.id) ||
          job.id === project.id),
    )
    .map((job) => ({
      id: job.id,
      title: job.name,
      status: job.status,
      created: job.created_at,
      thumbnail: job.source_url,
      records: byProject.get(job.id) || [],
    }));
  for (const [id, images] of byProject) {
    if (jobs.some((job) => job.id === id)) continue;
    tasks.push({
      id,
      title: images[0].context.title || "漫游方案",
      created: images[0].created_at,
      thumbnail: images.find((image) => image.thumbnail_url)?.thumbnail_url,
      records: images,
    });
  }
  if (!tasks.some((task) => task.id === project.id))
    tasks.push({ id: project.id, title: project.title, records: [] });
  return tasks.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
}

function taskStatus(task) {
  if (task.status === "awaiting_review") return "待核对";
  if (task.status === "running" || task.status === "queued") return "准备白模";
  if (task.status === "failed" || task.status === "cancelled")
    return "白模未完成";
  if (
    task.records.some((item) => ["queued", "generating"].includes(item.status))
  )
    return "全景生成中";
  const ready = new Set(
    task.records
      .filter((item) => item.status === "ready")
      .map((item) => item.context.roomId || item.context.roomName),
  ).size;
  return ready ? `已生成 ${ready} 间` : "待生成全景";
}

export default function RoamHistory({
  jobs,
  records,
  project,
  loading,
  error,
  onRetry,
  onClose,
  onOpen,
}) {
  const [taskId, setTaskId] = useState("");
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const tasks = buildTasks(jobs, records, project);
  const task = tasks.find((item) => item.id === taskId);
  const batches = new Map();
  for (const item of task?.records || []) {
    const key = item.batch_id || item.id;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(item);
  }
  async function open(target, version) {
    setOpening(true);
    setOpenError("");
    try {
      await onOpen(target, version);
    } catch (err) {
      setOpenError(err.message);
    } finally {
      setOpening(false);
    }
  }
  function imageRow(item) {
    const pending = ["generating", "queued"].includes(item.status);
    return (
      <li key={item.id}>
        <button
          type="button"
          disabled={opening || pending}
          onClick={() => open(task, item)}
        >
          {item.thumbnail_url ? (
            <img src={item.thumbnail_url} loading="lazy" alt="" />
          ) : (
            <span className="roam-history-placeholder">
              <Box size={18} />
            </span>
          )}
          <span className="roam-history-meta">
            <strong>{item.context.roomName || "全景取景"}</strong>
            <small>
              <time dateTime={item.created_at}>
                {historyDate.format(new Date(item.created_at))}
              </time>
              <span className="roam-history-status" data-status={item.status}>
                {imageStatus[item.status]}
              </span>
            </small>
          </span>
          {!pending && <ArrowUpRight size={17} />}
        </button>
      </li>
    );
  }
  return (
    <Modal title="漫游历史" className="roam-history" onClose={onClose}>
      {error && !loading && (
        <button type="button" className="secondary-button" onClick={onRetry}>
          重试读取全景记录
        </button>
      )}
      {loading && (
        <LoadingProgress compact indeterminate label="正在读取全景记录" />
      )}
      {openError && <p role="alert">{openError}</p>}
      {task ? (
        <>
          <div className="roam-history-filters">
            <button
              type="button"
              className="text-button"
              onClick={() => setTaskId("")}
            >
              <ArrowLeft size={15} /> 全部任务
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={opening}
              onClick={() => open(task)}
            >
              打开漫游任务 <ArrowUpRight size={14} />
            </button>
          </div>
          <h3 className="roam-history-task-title">{task.title}</h3>
          <ul className="roam-history-list">
            {[...batches].map(([key, items]) =>
              items[0].batch_id ? (
                <li key={key}>
                  <details className="roam-history-batch">
                    <summary>
                      批量生成全景{" "}
                      <time>
                        {historyDate.format(new Date(items[0].created_at))}
                      </time>
                      <span>
                        {items.filter((item) => item.status === "ready").length}
                        /{items.length} 间完成
                      </span>
                    </summary>
                    <ul className="roam-history-list">{items.map(imageRow)}</ul>
                  </details>
                </li>
              ) : (
                imageRow(items[0])
              ),
            )}
          </ul>
        </>
      ) : (
        <ul className="roam-history-list">
          {tasks.map((target) => (
            <li key={target.id}>
              <button
                type="button"
                disabled={opening}
                onClick={() =>
                  target.records.length ? setTaskId(target.id) : open(target)
                }
              >
                {target.thumbnail ? (
                  <img src={target.thumbnail} loading="lazy" alt="" />
                ) : (
                  <span className="roam-history-placeholder">
                    <Box size={18} />
                  </span>
                )}
                <span className="roam-history-meta">
                  <strong>{target.title}</strong>
                  <small>
                    {target.id === "sample" ? (
                      <span>示例空间</span>
                    ) : (
                      <span>#{target.id.slice(0, 6).toUpperCase()}</span>
                    )}
                    {target.created && (
                      <time dateTime={target.created}>
                        {historyDate.format(new Date(target.created))}
                      </time>
                    )}
                    <span
                      className="roam-history-status"
                      data-status={target.status}
                    >
                      {taskStatus(target)}
                    </span>
                  </small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
