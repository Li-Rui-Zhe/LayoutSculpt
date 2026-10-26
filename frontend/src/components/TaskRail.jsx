import VersionCompare from "./VersionCompare.jsx";
import Modal from "./Modal.jsx";
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
  const [comparing, setComparing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [groupId, setGroupId] = useState("all");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const counts = {
    all: projects.jobs.filter((j) => !j.archived).length,
    active: projects.jobs.filter((j) => !j.archived && !terminal(j.status))
      .length,
    done: projects.jobs.filter((j) => !j.archived && j.status === "succeeded")
      .length,
  };
  const jobs = projects.jobs.filter(
    (j) =>
      (filter === "archived" ? j.archived : !j.archived) &&
      (groupId === "all" || j.projectId === groupId) &&
      (filter === "all" ||
        filter === "archived" ||
        (filter === "failed" && j.status === "failed") ||
        (filter === "active"
          ? !terminal(j.status)
          : filter === "done" && j.status === "succeeded")) &&
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
      {comparing && (
        <VersionCompare
          job={comparing}
          versions={
            projects.groups.find((g) => g.id === comparing.projectId)
              ?.versions || []
          }
          onClose={() => setComparing(null)}
        />
      )}
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
            placeholder={
              projects.hasMoreHistory
                ? "搜索已加载任务名称或编号"
                : "搜索任务名称或编号"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="task-filters" aria-label="任务筛选">
          {[
            ["all", "全部"],
            ["active", "进行中"],
            ["done", "已完成"],
            ["failed", "失败"],
            ["archived", "已归档"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
              <span>
                {counts[id] ??
                  projects.jobs.filter((j) =>
                    id === "archived"
                      ? j.archived
                      : !j.archived && j.status === "failed",
                  ).length}
              </span>
            </button>
          ))}
        </div>
      </div>
      <label className="project-group-select">
        项目分组
        <select
          aria-label="项目分组"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
        >
          <option value="all">全部项目</option>
          {projects.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} · {g.versions.length} 个版本
            </option>
          ))}
        </select>
      </label>
      {groupId !== "all" && (
        <div className="project-version-actions">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await projects.archiveProject(groupId, filter !== "archived");
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {filter === "archived" ? "恢复整个项目" : "归档整个项目"}
          </button>
        </div>
      )}
      <div className="task-list">
        {projects.hasMoreHistory && (
          <p className="field-note">
            当前显示最近任务及关联父版本。筛选、统计与比较仅针对已加载记录，可继续加载历史。
          </p>
        )}
        {jobs.map((job) => (
          <div key={job.id} className="project-version-row">
            <button
              className={`task-card ${!creating && projects.selectedId === job.id ? "selected" : ""}`}
              aria-pressed={!creating && projects.selectedId === job.id}
              onClick={() => onSelect(job)}
            >
              <div className="task-card-top">
                <span className="task-number">
                  {projects.hasMoreHistory ? "版本" : `V${job.version}`} · #
                  {job.id.slice(0, 6).toUpperCase()}
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
            <div className="project-version-actions">
              {job.status === "succeeded" && (
                <button onClick={() => setComparing(job)}>比较</button>
              )}
              <button
                onClick={() => {
                  setEditing(job);
                  setName(job.name);
                  setError("");
                }}
              >
                重命名
              </button>
              <button
                disabled={busy || !terminal(job.status)}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await projects.changeMetadata(job.id, {
                      archived: !job.archived,
                    });
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {job.archived ? "恢复" : "归档"}
              </button>
            </div>
          </div>
        ))}
        {projects.hasMoreHistory && (
          <button
            className="secondary-button"
            disabled={projects.historyLoading}
            onClick={projects.loadMore}
          >
            {projects.historyLoading ? "正在加载…" : "加载更多历史任务"}
          </button>
        )}
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
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {editing && (
        <Modal title="重命名设计版本" onClose={() => !busy && setEditing(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await projects.changeMetadata(editing.id, { name });
                setEditing(null);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              版本名称
              <input
                value={name}
                maxLength={120}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="primary-button"
              disabled={busy || !name.trim()}
            >
              保存名称
            </button>
          </form>
        </Modal>
      )}
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
