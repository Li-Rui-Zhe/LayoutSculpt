import { useEffect, useState } from "react";
import LoadingProgress from "./LoadingProgress.jsx";
import { useProgressLifecycle } from "./useProgressLifecycle.js";
import "./operationStatus.css";

export default function OperationStatus({
  active,
  label,
  detail,
  progress,
  delay = 700,
  background = false,
  failed = false,
  cancelled = false,
  operationKey,
  successLabel = "已完成",
  className = "",
  estimated = false,
  estimateFrom = 4,
  estimateTo = 94,
  onIdle,
}) {
  const lifecycle = useProgressLifecycle({
    active,
    failed,
    cancelled,
    operationKey,
    delay,
  });
  const [asBackground, setAsBackground] = useState(background);
  useEffect(() => {
    if (!active && lifecycle.phase === "idle") onIdle?.();
  }, [active, lifecycle.phase, onIdle]);
  useEffect(() => {
    if (active) setAsBackground(background);
  }, [!!active, operationKey]);
  useEffect(() => {
    if (asBackground && lifecycle.complete) lifecycle.settle();
  }, [asBackground, lifecycle.complete, lifecycle.settle]);
  if (!lifecycle.visible) return null;
  return (
    <div
      className={`operation-status ${className}`}
      data-finishing={lifecycle.complete}
      data-background={asBackground}
      data-settled={lifecycle.phase === "settled"}
    >
      {asBackground ? (
        <p className="operation-background" role="status">
          {lifecycle.complete ? successLabel : label}
        </p>
      ) : (
        <LoadingProgress
          key={lifecycle.run}
          label={lifecycle.complete ? successLabel : label}
          detail={lifecycle.complete ? undefined : detail}
          progress={progress}
          estimated={estimated}
          estimateFrom={estimateFrom}
          estimateTo={estimateTo}
          operationKey={lifecycle.run}
          estimateKey={lifecycle.run}
          complete={lifecycle.complete}
          onComplete={lifecycle.settle}
          compact
        />
      )}
    </div>
  );
}
