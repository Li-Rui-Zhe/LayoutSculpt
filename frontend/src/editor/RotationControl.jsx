import { useEffect, useRef, useState } from "react";
import NumberField from "./NumberField.jsx";
import { normalizeRotation } from "./geometry.js";

export default function RotationControl({
  value,
  onChange,
  onPreview,
  onFinish,
  onCancel,
  scene = false,
  compact = false,
  disabled = false,
}) {
  const [sliding, setSliding] = useState(null);
  const gesture = useRef(null);
  const latest = useRef({ onCancel });
  latest.current = { onCancel };
  useEffect(
    () => () => {
      if (gesture.current !== null) latest.current.onCancel?.();
    },
    [],
  );
  const finish = () => {
    if (gesture.current === null) return;
    const angle = gesture.current;
    gesture.current = null;
    setSliding(null);
    (onFinish || onChange)(angle);
  };
  const cancel = () => {
    if (gesture.current === null) return;
    gesture.current = null;
    setSliding(null);
    onCancel?.();
  };
  const angle = sliding ?? normalizeRotation(value);
  return (
    <section
      className={`rotation-control ${compact ? "rotation-compact" : ""}`}
      aria-label={compact ? "快捷旋转家具" : "家具旋转"}
    >
      <div className="rotation-presets">
        {[-90, -45, 45, 90].map((delta) => (
          <button
            key={delta}
            type="button"
            disabled={disabled}
            aria-label={`${delta < 0 ? "向左" : "向右"}旋转 ${Math.abs(delta)} 度`}
            onClick={() => onChange(value + delta)}
          >
            {delta < 0 ? "↶" : "↷"} {Math.abs(delta)}°
          </button>
        ))}
      </div>
      <label className="rotation-slider">
        <span>
          {compact ? "朝向" : "拖动滑条调整朝向"}{" "}
          <output>{Math.round(angle)}°</output>
        </span>
        <input
          type="range"
          min="0"
          max="360"
          step="1"
          value={angle}
          disabled={disabled}
          aria-label={compact ? "快捷旋转角度" : "滑动调整旋转角度"}
          aria-valuetext={`${Math.round(angle)} 度`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onChange={(e) => {
            const next = Number(e.target.value);
            gesture.current = next;
            setSliding(next);
            onPreview?.(next);
          }}
          onPointerUp={finish}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
          onBlur={finish}
          onKeyUp={(e) => {
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(e.key)
            )
              finish();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
          }}
        />
      </label>
      {!compact && (
        <>
          <details className="rotation-exact">
            <summary>输入精确角度</summary>
            <NumberField
              label="旋转角度"
              value={normalizeRotation(value)}
              min={-360}
              max={360}
              unit="°"
              normalize={normalizeRotation}
              onCommit={onChange}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(0)}
            >
              恢复 0°
            </button>
          </details>
          <p className="field-note">
            {scene
              ? "点击箭头转向，或拖动滑条实时预览；松手保存，Esc 取消。"
              : "点击箭头或拖动滑条调整，松手保存。"}
          </p>
        </>
      )}
    </section>
  );
}
