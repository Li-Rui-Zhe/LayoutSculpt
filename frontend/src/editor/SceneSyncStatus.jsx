import { useCallback, useEffect, useState } from "react";
import LoadingProgress from "../components/LoadingProgress.jsx";
import { previewProgress, previewStages } from "./previewProgress.js";
import "./sceneSyncStatus.css";
import {
  PROGRESS_HOLD_MS,
  PROGRESS_FADE_MS,
} from "../components/progressMotion.js";

export default function SceneSyncStatus({
  state,
  hidden,
  hasContent,
  fallback,
}) {
  const { phase, revision } = state;
  const complete = hasContent || phase === "ready";
  // 保存版本的读取与后台重建是两条流程，不能用后台的生成百分比代表画布加载。
  const displayPhase = fallback ? "loading" : phase;
  const [visible, setVisible] = useState(false);
  const [settled, setSettled] = useState(false);
  const finish = useCallback(() => setSettled(true), []);
  useEffect(() => {
    if (hidden || phase === "error") {
      setVisible(false);
      setSettled(false);
      return;
    }
    if (complete) {
      if (!visible || !settled) return;
      const timer = setTimeout(
        () => setVisible(false),
        PROGRESS_HOLD_MS + PROGRESS_FADE_MS,
      );
      return () => clearTimeout(timer);
    }
    setSettled(false);
    const timer = setTimeout(() => setVisible(true), 350);
    return () => clearTimeout(timer);
  }, [complete, hidden, phase === "error", visible, settled]);
  if (!visible || hidden || phase === "error") return null;
  return (
    <div
      className="scene-sync-status"
      data-completing={complete}
      data-settled={settled}
      style={{
        "--finish-delay": `${PROGRESS_HOLD_MS}ms`,
        "--fade-duration": `${PROGRESS_FADE_MS}ms`,
      }}
    >
      <LoadingProgress
        compact
        label={
          complete
            ? fallback
              ? "保存版本已载入"
              : "三维模型已就绪"
            : fallback
              ? "正在载入保存版本"
              : previewStages[displayPhase] || "正在同步"
        }
        progress={previewProgress(displayPhase)}
        estimateKey={`${revision}:${displayPhase}`}
        operationKey={revision}
        estimateFrom={
          { pending: 4, building: 12, downloading: 80, loading: 91 }[
            displayPhase
          ] ?? 4
        }
        estimateTo={
          { pending: 10, building: 76, downloading: 88, loading: 98 }[
            displayPhase
          ] ?? 94
        }
        complete={complete}
        onComplete={finish}
        steps={
          fallback
            ? ["读取保存版本", "载入场景"]
            : ["生成模型", "接收模型", "载入场景"]
        }
        step={
          fallback
            ? 1
            : displayPhase === "loading" || displayPhase === "ready"
              ? 2
              : phase === "downloading"
                ? 1
                : 0
        }
        detail={
          complete
            ? fallback
              ? "可查看空间，最新修改仍在后台同步。"
              : "空间已显示，可以开始调整。"
            : "正在准备你的精细三维空间"
        }
      />
    </div>
  );
}
