import { useContext, useEffect, useState } from "react";
import { UnitContext } from "./UnitContext.js";
import { round } from "./geometry.js";
export default function NumberField({
  label,
  value,
  onCommit,
  min = -60,
  max = 60,
  unit = "m",
  normalize = round,
}) {
  const preferred = useContext(UnitContext),
    displayUnit = unit === "m" ? preferred : unit;
  const factor = unit === "m" ? { m: 1, cm: 100, mm: 1000 }[preferred] || 1 : 1;
  const [text, setText] = useState(String(round(value * factor))),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(String(round(value * factor)));
    setInvalid(false);
  }, [value, factor]);
  return (
    <label className={`edit-number ${invalid ? "invalid" : ""}`}>
      <span>{label}</span>
      <div>
        <input
          type="number"
          required
          aria-invalid={invalid}
          aria-label={label}
          value={text}
          min={min * factor}
          max={max * factor}
          step="any"
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(false);
          }}
          onBlur={() => {
            const number = Number(text);
            if (
              !text.trim() ||
              !Number.isFinite(number) ||
              number < min * factor ||
              number > max * factor
            ) {
              setInvalid(true);
              return;
            }
            const canonical = normalize(number / factor);
            onCommit(canonical);
            setText(String(round(canonical * factor)));
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setText(String(round(value * factor)));
              setInvalid(false);
            }
          }}
        />
        <small>{displayUnit}</small>
      </div>
      {invalid && (
        <small>
          请输入 {min * factor}～{max * factor}
        </small>
      )}
    </label>
  );
}
