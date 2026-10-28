export function projectGroups(jobs) {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const rootOf = (job) => {
    const visited = new Set();
    while (job && !visited.has(job.id)) {
      visited.add(job.id);
      const parent = byId.get(
        job.edited_of ||
          job.refine_of ||
          job.restructure_of ||
          job.reidentify_of ||
          job.rebuild_of,
      );
      if (!parent) return job;
      job = parent;
    }
    return job;
  };
  const grouped = new Map();
  for (const job of jobs) {
    const root = rootOf(job);
    if (!grouped.has(root.id))
      grouped.set(root.id, { id: root.id, name: root.name, versions: [] });
    grouped.get(root.id).versions.push(job);
  }
  return [...grouped.values()]
    .map((group) => ({
      ...group,
      versions: group.versions
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((job, index) => ({
          ...job,
          version: index + 1,
          projectId: group.id,
        })),
    }))
    .sort((a, b) =>
      b.versions.at(-1).created_at.localeCompare(a.versions.at(-1).created_at),
    );
}
