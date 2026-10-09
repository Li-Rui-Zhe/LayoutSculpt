import { useEffect, useId, useRef, useState } from "react";
import { Palette } from "lucide-react";
import {
  colorSwatches,
  colorTargets,
  normalizeColor,
  recolorParts,
} from "./colors.js";

export default function ColorDesigner({ design, partId, disabled, onCommit }) {
  const [scope, setScope] = useState("selected");
  const part = design?.parts.find((p) => p.id === partId);
  const color = normalizeColor(part?.color) || "#eee5d4";
  const [hex, setHex] = useState(color);
  const hexEdited = useRef(false);
  const gesture = useRef(null);
  const errorId = useId();
  const ids = colorTargets(design, partId, scope);
  const invalid = !normalizeColor(hex);
  const locked = disabled || !ids.length;
  useEffect(() => {
    setHex(color);
    hexEdited.current = false;
    gesture.current = null;
  }, [partId, scope]);
  useEffect(() => {
    setHex(color);
    hexEdited.current = false;
  }, [color]);
  const begin = () => {
    gesture.current = { group: crypto.randomUUID(), ids: [...ids] };
  };
  const apply = (value, continuous = false) => {
    const next = normalizeColor(value);
    if (!next || locked) return;
    if (continuous && !gesture.current) begin();
    const targetIds = continuous ? gesture.current.ids : ids;
    onCommit(
      (d) => recolorParts(d, targetIds, next),
      continuous ? gesture.current.group : undefined,
    );
    setHex(next);
    hexEdited.current = false;
  };
  const confirmHex = () => {
    if (!invalid && hexEdited.current) apply(hex);
  };
  return (
    <section className="diy-color-designer" aria-label="颜色 DIY">
      <h3>
        <Palette size={16} />
        颜色 DIY
      </h3>
      {!design ? (
        <p>先生成或选择一个素材，即可自由配色。</p>
      ) : (
        <>
          <fieldset disabled={disabled}>
            <label>
              应用范围
              <select
                aria-label="颜色应用范围"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="selected">选中部件</option>
                <option value="matching">同色部件</option>
                <option value="all">整件家具</option>
              </select>
            </label>
            <p className="diy-color-target" title={part?.name}>
              {scope === "selected"
                ? `当前：${part?.name || "请先选择部件"}`
                : `将修改 ${ids.length} 个部件${scope === "all" ? "，统一为一种颜色" : "（与选中部件同色）"}`}
            </p>
            <div className="diy-color-controls">
              <input
                type="color"
                aria-label="DIY 自定义颜色"
                value={color}
                disabled={locked}
                onFocus={begin}
                onPointerDown={begin}
                onBlur={() => {
                  gesture.current = null;
                }}
                onChange={(e) => apply(e.target.value, true)}
              />
              <label>
                HEX 色号
                <input
                  aria-label="DIY HEX 色号"
                  value={hex}
                  disabled={locked}
                  spellCheck={false}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? errorId : undefined}
                  onChange={(e) => {
                    setHex(e.target.value);
                    hexEdited.current = true;
                  }}
                  onBlur={confirmHex}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setHex(color);
                      hexEdited.current = false;
                    }
                  }}
                />
              </label>
            </div>
            {invalid && (
              <p id={errorId} className="diy-color-error" role="alert">
                请输入 3 或 6 位 HEX 色号，如 #315e49；Esc 恢复。
              </p>
            )}
            <div className="diy-color-swatches" aria-label="常用颜色">
              {colorSwatches.map(([name, value]) => (
                <button
                  key={value}
                  type="button"
                  disabled={locked}
                  aria-label={`换成${name}`}
                  title={`${name} ${value}`}
                  aria-pressed={
                    ids.length > 0 &&
                    ids.every(
                      (id) =>
                        normalizeColor(
                          design.parts.find((p) => p.id === id)?.color,
                        ) === value,
                    )
                  }
                  onClick={() => apply(value)}
                >
                  <i style={{ background: value }} />
                  <span>{name}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <p className="diy-color-hint">
            实时预览 · 支持撤销 · 保存素材后保留配色
          </p>
        </>
      )}
    </section>
  );
}
