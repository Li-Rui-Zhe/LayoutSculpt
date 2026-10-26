import { materials, materialCategories } from "../catalog.js";
import MaterialSample from "../components/MaterialSample.jsx";
import { useState } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

export default function SurfaceFinishPicker({
  category,
  value,
  onChange,
  disabled = false,
  hint,
  onBrowse,
}) {
  const label = category === "walls" ? "墙面" : "地板";
  const [expanded, setExpanded] = useState(false);
  const ids = materialCategories[category];
  const initial = ids.slice(0, 4);
  if (ids.includes(value) && !initial.includes(value)) initial[3] = value;
  const shown = expanded ? ids : initial;
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return (
    <fieldset className="surface-finish-picker" disabled={disabled}>
      <legend>{label}材质</legend>
      {onBrowse && (
        <button
          type="button"
          className="surface-library-link"
          onClick={onBrowse}
        >
          素材库 ↗
        </button>
      )}
      {hint && <p>{hint}</p>}
      <div className="surface-finish-grid">
        {shown.map((id) => {
          const m = materials.find((m) => m.id === id);
          return (
            <button
              key={id}
              type="button"
              aria-label={`选中${label}应用${m.name}`}
              aria-pressed={value === id}
              title={`${m.name} · ${m.family} · ${m.finish}`}
              onClick={() => onChange(id)}
            >
              <MaterialSample material={m} />
              {value === id && (
                <span className="surface-selected-mark">
                  <Check size={10} />
                </span>
              )}
              <strong>{m.name}</strong>
            </button>
          );
        })}
      </div>
      <div className="surface-picker-actions">
        {ids.length > 4 && (
          <button
            type="button"
            className="text-button surface-expand"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起材质" : `全部 ${ids.length} 款`}{" "}
            <Chevron size={12} />
          </button>
        )}
        <button
          type="button"
          className="text-button"
          aria-label={`恢复选中${label}的基础饰面`}
          disabled={!value}
          onClick={() => onChange(null)}
        >
          恢复默认
        </button>
      </div>
    </fieldset>
  );
}
