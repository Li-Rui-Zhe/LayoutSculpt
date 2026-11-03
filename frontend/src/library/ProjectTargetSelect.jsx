import { useMemo } from "react";
import { targetGroups } from "./projectTargets.js";

export default function ProjectTargetSelect({
  jobs,
  value,
  onChange,
  label,
  currentId = "",
  disabled = false,
  allowReview = false,
}) {
  const groups = useMemo(
    () =>
      targetGroups(
        jobs,
        allowReview ? ["succeeded", "awaiting_review"] : ["succeeded"],
      ),
    [jobs, allowReview],
  );
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">选择目标项目与版本</option>
      {groups.map((group) => (
        <optgroup key={group.id} label={group.name}>
          {group.versions.map((job, index) => (
            <option key={job.id} value={job.id}>
              {group.name} · V{job.version}
              {job.id === currentId
                ? " · 当前编辑"
                : index === 0
                  ? " · 最新版本"
                  : ""}
              {job.updated_at ? ` · ${job.updated_at.slice(0, 10)}` : ""}
              {job.status === "awaiting_review" ? " · 待核对" : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
