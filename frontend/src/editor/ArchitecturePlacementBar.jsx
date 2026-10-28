import { placementPreset } from "./architecturePlacement.js";
import NumberField from "./NumberField.jsx";

export default function ArchitecturePlacementBar({
  placement,
  result,
  onChange,
  onConfirm,
  onCancel,
  busy,
}) {
  const preset = placementPreset(placement.configuration);
  const field = (label, key, min, max, unit = "m") => (
    <NumberField
      label={label}
      value={placement.configuration[key] ?? preset[key]}
      min={min}
      max={max}
      unit={unit}
      onCommit={(value) => {
        onChange({
          configuration: { ...placement.configuration, [key]: value },
        });
        return true;
      }}
    />
  );
  return (
    <section
      className="architecture-placement-bar"
      aria-label={preset.light ? "灯具放置" : "建筑构件放置"}
      data-valid={result.valid}
    >
      <div>
        <strong>放置{preset.name}</strong>
        <p role="status">{result.message}</p>
      </div>
      <fieldset disabled={busy}>
        {preset.light ? (
          <>
            {field("光源离地高度", "elevation", 0.1, 4.5)}
            {field("灯具亮度", "lumens", 0, 3000, "lm")}
          </>
        ) : (
          <>
            {field(
              preset.opening ? "放置宽度" : "放置长度",
              preset.opening ? "width" : "length",
              0.1,
              30,
            )}
            {field("放置高度", "height", preset.opening ? 0.1 : 0.3, 4.5)}
          </>
        )}
        {!preset.opening && !preset.light && (
          <button
            onClick={() =>
              onChange({ rotation: (placement.rotation + 90) % 360 })
            }
          >
            旋转 90° · {placement.rotation}°
          </button>
        )}
        <button onClick={() => onConfirm()} disabled={!result.valid}>
          确认放置
        </button>
        <button onClick={onCancel}>取消放置</button>
      </fieldset>
    </section>
  );
}
