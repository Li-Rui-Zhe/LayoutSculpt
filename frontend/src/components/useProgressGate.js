import { useCallback, useEffect, useRef, useState } from "react";

// 提交成功后等已展示的进度条收尾，再切换页面；快速请求无需额外停留。
export function useProgressGate() {
  const [completed, setCompleted] = useState(false);
  const pending = useRef(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.(false);
      pending.current = null;
    };
  }, []);
  const reset = useCallback(() => {
    pending.current?.(false);
    pending.current = null;
    setCompleted(false);
  }, []);
  const finish = useCallback(() => {
    if (!alive.current) return Promise.resolve(false);
    setCompleted(true);
    return new Promise((resolve) => {
      pending.current = resolve;
    });
  }, []);
  const onIdle = useCallback(() => {
    pending.current?.(true);
    pending.current = null;
  }, []);
  return { completed, reset, finish, onIdle };
}
