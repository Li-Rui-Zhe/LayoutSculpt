import { useContext, useEffect, useRef, useState } from "react";
import { LiveParameterContext } from "./LiveParameterContext.js";
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
  const live = useContext(LiveParameterContext);
  const timer = useRef(null);
  const preferred = useContext(UnitContext),
    displayUnit = unit === "m" ? preferred : unit;
  const factor = unit === "m" ? { m: 1, cm: 100, mm: 1000 }[preferred] || 1 : 1;
  const [text, setText] = useState(String(round(value * factor))),
    [invalid, setInvalid] = useState(false);
  const latest = useRef(null);
  const cancel = () => clearTimeout(timer.current);
  const commit = (input) => {
    cancel();
    const number = Number(input);
    if (
      !input.trim() ||
      !Number.isFinite(number) ||
      number < (min - 1e-9) * factor ||
      number > (max + 1e-9) * factor
    ) {
      setInvalid(
        `请输入 ${round(min * factor)}～${round(max * factor)} ${displayUnit}`,
      );
      return;
    }
    const canonical = normalize(number / factor);
    const result = canonical === value ? undefined : onCommit(canonical);
    if (result === false || typeof result === "string") {
      setInvalid(
        typeof result === "string"
          ? result
          : "当前修改未应用，请检查对象状态。",
      );
      return;
    }
    setText(String(round(canonical * factor)));
    setInvalid(false);
  };
  latest.current = commit;
  useEffect(() => cancel, []);
  useEffect(() => {
    if (!live) cancel();
  }, [live]);
  useEffect(() => {
    cancel();
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
          aria-invalid={!!invalid}
          aria-label={label}
          data-number-value={String(round(value * factor))}
          value={text}
          min={min * factor}
          max={max * factor}
          step="any"
          onChange={(e) => {
            const input = e.target.value;
            cancel();
            setText(input);
            setInvalid(false);
            if (live)
              timer.current = setTimeout(() => latest.current(input), 450);
          }}
          onBlur={() => commit(text)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
              setText(String(round(value * factor)));
              setInvalid(false);
            }
          }}
        />
        <small>{displayUnit}</small>
      </div>
      {invalid && <small>{invalid}</small>}
    </label>
  );
}
