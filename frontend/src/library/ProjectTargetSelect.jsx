import { useMemo, useState } from "react";
import {
  targetGroups,
  visibleTargets,
  cleanVersionName,
} from "./projectTargets.js";

export default function ProjectTargetSelect({
  jobs,
  value,
  onChange,
  label,
  currentId = "",
  disabled = false,
  allowReview = false,
}) {
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState(false);
  const groups = useMemo(
    () =>
      targetGroups(
        jobs,
        allowReview ? ["succeeded", "awaiting_review"] : ["succeeded"],
      ),
    [jobs, allowReview],
  );
  return (
    <div className="project-target-picker">
      {groups.length > 5 && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索项目名称"
          aria-label="搜索目标项目"
          disabled={disabled}
        />
      )}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">选择目标项目与版本</option>
        {visibleTargets(groups, { query, history, selected: value }).map(
          (group) => (
            <optgroup key={group.id} label={group.name}>
              {group.versions.map((job) => (
                <option key={job.id} value={job.id}>
                  {cleanVersionName(job.name || group.name)} · V{job.version}
                  {job.id === currentId
                    ? " · 当前编辑"
                    : job.id === group.latestVersionId
                      ? " · 最新版本"
                      : ""}
                  {job.updated_at ? ` · ${job.updated_at.slice(0, 10)}` : ""}
                  {job.status === "awaiting_review" ? " · 待核对" : ""}
                </option>
              ))}
            </optgroup>
          ),
        )}
      </select>
      {groups.some((group) => group.versions.length > 1) && (
        <label className="project-target-history">
          <input
            type="checkbox"
            checked={history}
            onChange={(event) => setHistory(event.target.checked)}
            disabled={disabled}
          />
          显示历史版本（默认只列最新可用版）
        </label>
      )}
    </div>
  );
}
