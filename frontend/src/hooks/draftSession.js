// Each loaded draft owns its revision and pending writes, including after navigation.
import { mergeDraft } from "./mergeDraft.js";
export function createDraftSession(
  key,
  revision,
  write,
  report,
  delay = 650,
  options = {},
) {
  let pending = null,
    saved = options.baseDocument ? JSON.stringify(options.baseDocument) : null,
    timer,
    blocked = false,
    running = null,
    failures = 0,
    closed = false;
  const flush = () => {
    clearTimeout(timer);
    if (running) return running;
    running = Promise.resolve()
      .then(async () => {
        let mergeAttempts = 0;
        while (pending && !blocked) {
          const encoded = pending;
          pending = null;
          if (encoded === saved) continue;
          try {
            const result = await write(key, {
              revision,
              document: JSON.parse(encoded),
            });
            revision = result.revision;
            saved = encoded;
            failures = 0;
            report({
              message: `已同步本机 · ${new Date(result.updated_at).toLocaleTimeString("zh-CN")}`,
              error: "",
              syncedDocument: JSON.parse(encoded),
              syncedRevision: revision,
            });
          } catch (error) {
            if (
              error.status === 409 &&
              saved &&
              options.read &&
              mergeAttempts++ < 2
            ) {
              try {
                const remote = await options.read(key);
                if (remote.document) {
                  const merged = mergeDraft(
                    JSON.parse(saved),
                    JSON.parse(pending || encoded),
                    remote.document,
                  );
                  if (!merged.conflicts.length) {
                    revision = remote.revision;
                    saved = JSON.stringify(remote.document);
                    pending = JSON.stringify(merged.document);
                    report({
                      message: "已自动合并其他页面的独立修改",
                      error: "",
                      document: merged.document,
                    });
                    continue;
                  }
                  error.message = `有 ${merged.conflicts.length} 处修改冲突，已保留当前草稿。请备份后读取最新内容：${merged.conflicts.slice(0, 3).join("、")}`;
                }
              } catch (mergeError) {
                error.message = mergeError.message;
              }
            }
            const retryable =
              !error.status || error.status >= 500 || error.status === 429;
            pending ||= encoded;
            blocked = !retryable;
            report({
              message: retryable ? "连接恢复后自动同步" : "尚未同步后端",
              error: error.message,
            });
            if (retryable && !closed) {
              timer = setTimeout(
                flush,
                Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)),
              );
              timer.unref?.();
            }
            break;
          }
        }
      })
      .finally(() => {
        running = null;
      });
    return running;
  };
  return {
    flush,
    close() {
      closed = true;
      clearTimeout(timer);
      return flush();
    },
    schedule(document) {
      const encoded = JSON.stringify(document);
      if (blocked || encoded === pending || (encoded === saved && !running))
        return;
      pending = encoded;
      report({ message: "正在同步草稿…", error: "" });
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
  };
}
