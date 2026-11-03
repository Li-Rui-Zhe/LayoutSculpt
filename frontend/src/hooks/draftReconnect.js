// 初次打开时服务离线也能编辑；恢复读取只执行一次，不负责覆盖本地文档。
export function createDraftReconnect(read, connected, delay = 1500) {
  const abort = new AbortController();
  let closed = false,
    running = null,
    timer,
    attempts = 0;
  const retry = () => {
    clearTimeout(timer);
    if (closed) return Promise.resolve();
    if (running) return running;
    running = Promise.resolve()
      .then(() => (closed ? null : read(abort.signal)))
      .then((remote) => {
        if (closed) return;
        if (!Number.isInteger(remote?.revision) || remote.revision < 0)
          throw new Error("草稿服务返回无效版本");
        connected(remote);
        closed = true;
      })
      .catch(() => {
        if (!closed) {
          timer = setTimeout(
            retry,
            Math.min(30000, delay * 2 ** Math.min(attempts++, 5)),
          );
          timer.unref?.();
        }
      })
      .finally(() => {
        running = null;
      });
    return running;
  };
  return {
    retry,
    close() {
      closed = true;
      clearTimeout(timer);
      abort.abort();
    },
  };
}
