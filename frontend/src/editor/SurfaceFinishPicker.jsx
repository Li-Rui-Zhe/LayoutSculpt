import { materials, materialCategories } from "../catalog.js";
import MaterialSample from "../components/MaterialSample.jsx";

export default function SurfaceFinishPicker({
  category,
  value,
  onChange,
  disabled = false,
  hint,
}) {
  const label = category === "walls" ? "墙面" : "地板";
  return (
    <fieldset className="surface-finish-picker" disabled={disabled}>
      <legend>{label} DIY · 材质样板</legend>
      <p>
        {hint ||
          (category === "walls"
            ? "仅修改选中墙体的两侧饰面，其他墙体不变。"
            : "仅修改选中房间的地板，其他房间不变。")}
      </p>
      <div className="surface-finish-grid">
        {materialCategories[category].map((id) => {
          const m = materials.find((m) => m.id === id);
          return (
            <button
              key={id}
              type="button"
              aria-label={`选中${label}应用${m.name}`}
              aria-pressed={value === id}
              onClick={() => onChange(id)}
            >
              <MaterialSample material={m} />
              <strong>{m.name}</strong>
              <small>
                {m.family} · {m.finish}
              </small>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="text-button"
        disabled={!value}
        onClick={() => onChange(null)}
      >
        恢复选中{label}的基础饰面
      </button>
    </fieldset>
  );
}
