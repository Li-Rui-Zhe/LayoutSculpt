import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { previewProgress, previewStages } from "./previewProgress.js";
import "./sceneSyncStatus.css";

export default function SceneSyncStatus({ state, hidden, hasModel }) {
  const { phase, revision } = state;
  const [visible, setVisible] = useState(false);
  const [display, setDisplay] = useState({ revision, value: 5 });
  useEffect(() => {
    if (phase === "error") {
      setVisible(false);
      return;
    }
    if (phase === "ready") {
      setDisplay({ revision, value: 100 });
      const timer = setTimeout(() => setVisible(false), 850);
      return () => clearTimeout(timer);
    }
    const start = performance.now();
    const update = () =>
      setDisplay((previous) => ({
        revision,
        value: Math.max(
          previous.revision === revision ? previous.value : 0,
          previewProgress(phase, performance.now() - start),
        ),
      }));
    update();
    const delay = setTimeout(() => setVisible(true), 350);
    const timer = setInterval(update, 120);
    return () => {
      clearTimeout(delay);
      clearInterval(timer);
    };
  }, [phase, revision]);
  if (!visible || hidden || phase === "error") return null;
  const complete = phase === "ready";
  const value = complete
    ? 100
    : Math.min(
        98,
        Math.floor(
          display.revision === revision
            ? display.value
            : previewProgress(phase),
        ),
      );
  const Icon = complete ? Check : Sparkles;
  return (
    <div className="scene-sync-status" data-complete={complete}>
      <div
        className="scene-sync-status-heading"
        role="status"
        aria-live="polite"
      >
        <Icon size={14} aria-hidden="true" />
        <strong>{previewStages[phase] || "正在同步"}</strong>
        <span>
          {complete ? "已完成" : "预计进度"} <b>{value}%</b>
        </span>
      </div>
      <div
        className="scene-sync-track"
        role="progressbar"
        aria-label="三维同步进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${previewStages[phase]}，${complete ? "完成" : "预计"} ${value}%`}
      >
        <div className="scene-sync-fill" style={{ width: `${value}%` }} />
      </div>
      {!complete && (
        <small>
          {hasModel ? "保留当前画面，可继续选择和编辑" : "正在准备你的三维空间"}
        </small>
      )}
    </div>
  );
}
