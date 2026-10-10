import { useEffect, useRef, useState } from "react";
import DiyPreview from "../diy/DiyPreview.jsx";

export default function LivePreview({ document, jobId, onSelect, onClose }) {
  const [night, setNight] = useState(false);
  const [url, setUrl] = useState(null),
    [status, setStatus] = useState("正在准备三维校对…");
  const currentUrl = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setStatus("正在构建当前草稿的三维校对…");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...document, name: "实时校对" }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const value = await response.json();
          throw Error(
            typeof value.detail === "string"
              ? value.detail
              : "请先修正平面图中的无效尺寸",
          );
        }
        const blob = await response.blob();
        if (!alive) return;
        const next = URL.createObjectURL(blob);
        if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
        currentUrl.current = next;
        setUrl(next);
        setStatus("三维已同步 · 点击对象返回属性");
      } catch (e) {
        if (alive) setStatus(e.message);
      }
    }, 900);
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [document, jobId]);
  useEffect(
    () => () => {
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    },
    [],
  );
  return (
    <section className="live-plan-preview">
      <p role="status">{status}</p>
      <div className="live-preview-light">
        <button aria-pressed={!night} onClick={() => setNight(false)}>
          白天
        </button>
        <button aria-pressed={night} onClick={() => setNight(true)}>
          夜晚
        </button>
        <button style={{ marginLeft: "auto" }} onClick={onClose}>
          关闭三维校对
        </button>
      </div>
      {url && (
        <DiyPreview
          night={night}
          modelUrl={url}
          cutaway
          onObjectSelect={onSelect}
        />
      )}
    </section>
  );
}
