import { useEffect, useState } from "react";
import { round } from "./geometry.js";
export default function NumberField({
  label,
  value,
  onCommit,
  min = -60,
  max = 60,
  unit = "m",
}) {
  const [text, setText] = useState(String(round(value))),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(String(round(value)));
    setInvalid(false);
  }, [value]);
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
          min={min}
          max={max}
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
              number < min ||
              number > max
            ) {
              setInvalid(true);
              return;
            }
            onCommit(round(number));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <small>{unit}</small>
      </div>
      {invalid && (
        <small>
          请输入 {min}～{max}
        </small>
      )}
    </label>
  );
}
