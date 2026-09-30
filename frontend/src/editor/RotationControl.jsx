import NumberField from "./NumberField.jsx";
import { normalizeRotation } from "./geometry.js";

export default function RotationControl({ value, onChange }) {
  return (
    <section className="rotation-control" aria-label="家具旋转">
      <NumberField
        label="旋转角度"
        value={normalizeRotation(value)}
        min={-360}
        max={360}
        unit="°"
        normalize={normalizeRotation}
        onCommit={onChange}
      />
      <div className="rotation-presets">
        {[-90, -15, 15, 90].map((angle) => (
          <button
            key={angle}
            type="button"
            aria-label={`${angle < 0 ? "逆" : "顺"}时针旋转 ${Math.abs(angle)} 度`}
            onClick={() => onChange(value + angle)}
          >
            {angle > 0 ? "+" : ""}
            {angle}°
          </button>
        ))}
        <button type="button" onClick={() => onChange(0)}>
          归零
        </button>
      </div>
      <p className="field-note">
        拖动绿色手柄旋转 · 按住 Shift 吸附 15°
        <br />
        以中心旋转，正角度为顺时针。
      </p>
    </section>
  );
}
