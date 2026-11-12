export function elapsedLabel(created, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(created)) / 1000));
  if (!Number.isFinite(seconds)) return "正在处理";
  return seconds < 60
    ? `已等待 ${seconds} 秒`
    : `已等待 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
// 首次读取失败也重试；连续三次重试失败后保留手动恢复入口。
export function pollInteriorHistory({
  load,
  onData,
  onError,
  schedule = setTimeout,
  unschedule = clearTimeout,
}) {
  let stopped = false,
    timer,
    failures = 0;
  async function poll() {
    try {
      const value = await load();
      if (stopped) return;
      failures = 0;
      onData(value);
      if (value.items.some((item) => item.status === "generating"))
        timer = schedule(poll, 2000);
    } catch (error) {
      if (stopped) return;
      failures++;
      onError(error, failures <= 3);
      if (failures <= 3) timer = schedule(poll, 1000 * 2 ** failures);
    }
  }
  void poll();
  return () => {
    stopped = true;
    unschedule(timer);
  };
}
export function filterInteriorImages(
  items,
  { query = "", project = "", archived = false } = {},
) {
  const term = query.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      !!item.archived === archived &&
      (!project || (item.context?.projectId || "legacy") === project) &&
      (!term ||
        [item.prompt, item.context?.title, item.context?.roomName]
          .join(" ")
          .toLocaleLowerCase()
          .includes(term)),
  );
}
