import { useEffect, useRef, useState } from "react";
import "./contextRecovery.css";

// Three.js 负责重建 GPU 资源，设计数据及选中对象仍保留在原场景中。
export default function ContextRecovery({ target, onRestored, onLost: notifyLost }) {
  const [lost, setLost] = useState(false);
  const [message, setMessage] = useState("");
  const canvas = useRef(null),
    extension = useRef(null),
    callback = useRef(onRestored),
    lostCallback = useRef(notifyLost),
    timeout = useRef(null);
  callback.current = onRestored;
  lostCallback.current = notifyLost;
  useEffect(() => {
    let element,
      frame,
      attempts = 0;
    const onLost = (event) => {
      event.preventDefault();
      lostCallback.current?.();
      setLost(true);
      setMessage("三维显示暂时中断，设计内容仍保留。");
    };
    const restored = () => {
      clearTimeout(timeout.current);
      setLost(false);
      setMessage("");
      callback.current?.();
    };
    const bind = () => {
      element = target();
      if (!element) {
        if (++attempts < 60) frame = requestAnimationFrame(bind);
        return;
      }
      canvas.current = element;
      extension.current = element.getContext("webgl2")?.getExtension("WEBGL_lose_context");
      element.addEventListener("webglcontextlost", onLost);
      element.addEventListener("webglcontextrestored", restored);
    };
    bind();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout.current);
      element?.removeEventListener("webglcontextlost", onLost);
      element?.removeEventListener("webglcontextrestored", restored);
    };
  }, []);
  if (!lost) return null;
  const recover = () => {
    clearTimeout(timeout.current);
    try {
      extension.current?.restoreContext();
    } catch {
      /* 保留提示，可再次尝试。 */
    }
    setMessage("正在恢复三维显示，设计内容仍保留…");
    timeout.current = setTimeout(
      () =>
        setMessage(
          "暂时无法恢复。可关闭其他三维页面后再试；刷新前请先保存设计。",
        ),
      5000,
    );
  };
  return (
    <div className="context-recovery" role="alert">
      <p>{message}</p>
      <button className="secondary-button" onClick={recover}>
        恢复三维预览
      </button>
    </div>
  );
}
