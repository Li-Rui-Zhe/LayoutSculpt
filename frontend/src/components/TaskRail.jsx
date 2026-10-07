import { useState } from "react";
import {
  Search,
  LayoutGrid,
  Box,
  Check,
  LoaderCircle,
  Clock3,
  AlertCircle,
  FolderOpen,
} from "lucide-react";
import { terminal } from "../api.js";

export const statusNames = {
  queued: "排队中",
  running: "生成中",
  awaiting_review: "待核对",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
export function StatusBadge({ status }) {
  const Icon =
    {
      queued: Clock3,
      running: LoaderCircle,
      awaiting_review: AlertCircle,
      succeeded: Check,
      failed: AlertCircle,
      cancelled: Clock3,
    }[status] || Box;
  return (
    <span className={`status-badge ${status}`}>
      <Icon size={11} className={status === "running" ? "spin" : ""} />
      {statusNames[status] || "示例"}
    </span>
  );
}
export default function TaskRail({ projects, creating, open, onSelect }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const counts = {
    all: projects.jobs.length,
    active: projects.jobs.filter((j) => !terminal(j.status)).length,
    done: projects.jobs.filter((j) => j.status === "succeeded").length,
  };
  const jobs = projects.jobs.filter(
    (j) =>
      (filter === "all" ||
        (filter === "active"
          ? !terminal(j.status)
          : j.status === "succeeded")) &&
      `${j.name} ${j.result?.title || ""} ${j.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <aside
      className={`task-rail ${open ? "open" : ""}`}
      id="task-drawer"
      hidden={!open}
      aria-label="生成任务栏"
    >
      <div className="rail-top">
        <div className="rail-title">
          <LayoutGrid size={17} />
          <h2>我的任务</h2>
          <span>{counts.all.toString().padStart(2, "0")}</span>
        </div>
        <label className="task-search">
          <Search size={14} />
          <input
            aria-label="搜索任务"
            placeholder="搜索任务名称或编号"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="task-filters" aria-label="任务筛选">
          {[
            ["all", "全部"],
            ["active", "进行中"],
            ["done", "已完成"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
              <span>{counts[id]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="task-list">
        {jobs.map((job) => (
          <button
            key={job.id}
            className={`task-card ${!creating && projects.selectedId === job.id ? "selected" : ""}`}
            aria-pressed={!creating && projects.selectedId === job.id}
            onClick={() => onSelect(job)}
          >
            <div className="task-card-top">
              <span className="task-number">
                #{job.id.slice(0, 6).toUpperCase()}
              </span>
              <StatusBadge status={job.status} />
            </div>
            <div className="task-card-body">
              <img src={job.source_url} alt="" loading="lazy" />
              <div>
                <h3>{job.name.replace(/\.(png|jpe?g|webp)$/i, "")}</h3>
                <p>
                  {job.status === "awaiting_review"
                    ? "请核对墙体与门窗"
                    : job.edited_of
                      ? "人工设计版本"
                      : job.restructure_of
                        ? "结构复核版本"
                        : job.refine_of
                          ? "家具规划版本"
                          : job.rebuild_of
                            ? "三维效果更新"
                            : job.result?.title || job.stage}
                </p>
                <time>
                  {new Date(job.created_at).toLocaleString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            </div>
            {!terminal(job.status) && (
              <div className="task-card-progress">
                <span>
                  <i style={{ width: `${job.progress}%` }} />
                </span>
                <small>{job.progress}%</small>
              </div>
            )}
          </button>
        ))}
        {!jobs.length && (
          <div className="rail-empty">
            <FolderOpen size={27} />
            <p>
              {projects.loading
                ? "正在读取任务…"
                : query
                  ? "没有找到匹配任务"
                  : filter === "active"
                    ? "暂无进行中的任务"
                    : "这里将保存你的设计任务"}
            </p>
          </div>
        )}
      </div>
      <div className="rail-bottom">
        <button
          className={
            !creating && !projects.job && projects.selectedId === "sample"
              ? "selected"
              : ""
          }
          onClick={() => onSelect(null)}
        >
          <Box size={17} />
          <span>
            探索示例空间<small>体验三维设计与材质搭配</small>
          </span>
          <span>↗</span>
        </button>
        <p>
          <i />
          每次生成独立保存 · 切换不打断任务
        </p>
      </div>
    </aside>
  );
}
