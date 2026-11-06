import { projectGroups } from "../projects.js";

export function cleanVersionName(name = "") {
  return (
    name
      .replace(/(?: · (?:设计|微调|V\d+))+$/u, "")
      .replace(/\.(png|jpe?g|webp)$/iu, "")
      .trim() || "未命名设计"
  );
}

// 先按完整关系分组，再筛选可用版本，避免中间失败版本打断项目关系。
export function targetGroups(jobs, statuses = ["succeeded"]) {
  return projectGroups(jobs)
    .map((group) => ({
      ...group,
      name: cleanVersionName(group.name),
      versions: group.versions
        .filter((job) => statuses.includes(job.status) && !job.archived)
        .reverse(),
    }))
    .filter((group) => group.versions.length);
}

export function nextDesignName(name, version) {
  const suffix = ` · V${version}`;
  return cleanVersionName(name).slice(0, 120 - suffix.length) + suffix;
}

// 过滤列表不改选择值；旧版本被选中时仍保留，避免误存到最新版。
export function visibleTargets(
  groups,
  { query = "", history = false, selected = "" } = {},
) {
  const needle = query.trim().toLocaleLowerCase();
  return groups
    .map((group) => ({
      ...group,
      latestVersionId: group.versions[0]?.id,
      versions: group.versions.filter(
        (job, index) =>
          job.id === selected ||
          ((history || index === 0) &&
            `${group.name} ${job.name || ""}`
              .toLocaleLowerCase()
              .includes(needle)),
      ),
    }))
    .filter((group) => group.versions.length);
}
