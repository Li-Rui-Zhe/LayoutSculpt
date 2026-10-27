// 一次只构建一个草稿；旧请求即使不响应取消，也不能覆盖较新的结果。
export function createPreviewQueue({
  build,
  publish,
  report,
  delay = 300,
  initialRevision = 0,
}) {
  let serial = initialRevision,
    timer,
    controller,
    closed = false;
  return {
    cancel() {
      serial++;
      clearTimeout(timer);
      controller?.abort();
    },
    submit(document) {
      const revision = ++serial;
      clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      report({ phase: "pending", revision });
      timer = setTimeout(async () => {
        if (closed || revision !== serial) return;
        report({ phase: "building", revision });
        try {
          const result = await build(document, signal, (status) => {
            if (!closed && revision === serial && !signal.aborted)
              report({ ...status, revision });
          });
          if (!closed && revision === serial)
            publish({ result, document, revision });
        } catch (error) {
          if (!closed && revision === serial && !signal.aborted)
            report({ phase: "error", revision, message: error.message });
        }
      }, delay);
    },
    close() {
      closed = true;
      serial++;
      clearTimeout(timer);
      controller?.abort();
    },
  };
}
