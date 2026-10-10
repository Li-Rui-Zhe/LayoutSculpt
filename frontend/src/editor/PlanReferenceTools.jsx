export default function PlanReferenceTools({
  displayUnit,
  setDisplayUnit,
  measureMode,
  setMeasureMode,
  setBoxMode,
  measure,
  setMeasure,
  overlay,
  setOverlay,
  opacity,
  setOpacity,
  snap,
  setSnap,
  registration,
  setRegistration,
  constraintError,
}) {
  return (
    <>
      <div className="batch-toolbar design-tools">
        <label>
          尺寸单位
          <select
            aria-label="设计尺寸显示单位"
            value={displayUnit}
            onChange={(e) => setDisplayUnit(e.target.value)}
          >
            <option value="m">米</option>
            <option value="cm">厘米</option>
            <option value="mm">毫米</option>
          </select>
        </label>
        <button
          aria-pressed={measureMode}
          onClick={() => {
            setMeasureMode(!measureMode);
            setBoxMode(false);
            setMeasure([]);
          }}
        >
          测量距离
        </button>
        <button aria-pressed={overlay} onClick={() => setOverlay(!overlay)}>
          原图叠加
        </button>
        {overlay && (
          <label>
            原图透明度{" "}
            <input
              aria-label="原图透明度"
              type="range"
              min="0"
              max="1"
              step=".05"
              value={opacity}
              onChange={(e) => setOpacity(+e.target.value)}
            />
          </label>
        )}
        <button aria-pressed={snap} onClick={() => setSnap(!snap)}>
          贴墙吸附 {snap ? "开" : "关"}
        </button>
        {measure.length === 2 && (
          <span>
            距离：
            {Math.hypot(
              measure[1].x - measure[0].x,
              measure[1].y - measure[0].y,
            ).toFixed(3)}{" "}
            m
          </span>
        )}
        {measureMode && <span>点击两个位置测量；再次点击重新测量。</span>}
      </div>
      {constraintError && (
        <p className="workspace-note" role="alert">
          {constraintError}
        </p>
      )}
      {overlay && (
        <details className="overlay-registration">
          <summary>原图对齐 · 偏移、缩放和旋转</summary>
          <div className="batch-toolbar">
            {[
              ["x", "水平偏移（米）", -100, 100, 0.05],
              ["y", "垂直偏移（米）", -100, 100, 0.05],
              ["scale", "比例", 0.05, 20, 0.01],
              ["rotation", "旋转（°）", -180, 180, 1],
            ].map(([key, label, min, max, step]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={label}
                  type="number"
                  value={registration[key]}
                  min={min}
                  max={max}
                  step={step}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isFinite(value) && value >= min && value <= max)
                      setRegistration({ ...registration, [key]: value });
                  }}
                />
              </label>
            ))}
            <button
              onClick={() =>
                setRegistration({ x: 0, y: 0, scale: 1, rotation: 0 })
              }
            >
              重置对齐
            </button>
          </div>
          <small>
            选择原图中两处墙角，与平面图逐一对齐；只调整参考图，不改变设计尺寸。
          </small>
        </details>
      )}
    </>
  );
}
