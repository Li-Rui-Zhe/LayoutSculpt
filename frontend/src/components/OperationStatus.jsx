import { useEffect, useState } from "react";
import "./operationStatus.css";

export default function OperationStatus({
  active,
  label,
  detail,
  progress,
  delay = 700,
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    if (!active) return;
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);
  if (!active || !visible) return null;
  const known = Number.isFinite(progress);
  return (
    <div className="operation-status" role="status" aria-live="polite">
      <strong>{label}</strong>
      {detail && <span>{detail}</span>}
      <progress
        aria-label={label}
        max="100"
        {...(known ? { value: Math.max(0, Math.min(100, progress)) } : {})}
      />
    </div>
  );
}
