import { useEffect, useMemo, useRef, useState } from "react";
import { openingNames, round, wallLength } from "./geometry.js";
import {
  openingGaps,
  openingPosition,
  validateOpening,
} from "./openingPlacement.js";

const numeric = (value) => (value.trim() === "" ? NaN : Number(value));

export default function OpeningComposer({
  layout,
  wallId,
  kind,
  anchor,
  onPreview,
  onAdd,
  onCancel,
}) {
  const wall = layout.walls.find((item) => item.id === wallId);
  const [values, setValues] = useState(() => ({
    width: kind === "window" ? "1.2" : "0.9",
    height: kind === "window" ? "1.2" : "2.1",
    bottom: kind === "window" ? "0.9" : "0",
    offset: String(
      openingPosition(layout, wall, kind === "window" ? 1.2 : 0.9),
    ),
    angle: "90",
    door_leaf: true,
    hinge: "start",
    swing: "left",
  }));
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 980px)").matches)
      heading.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  useEffect(() => {
    setValues((current) => ({
      ...current,
      offset: String(openingPosition(layout, wall, numeric(current.width))),
    }));
  }, [wallId]);
  useEffect(() => {
    if (!wall || !anchor || anchor.wallId !== wallId) return;
    setValues((current) => {
      const width = numeric(current.width);
      if (!Number.isFinite(width)) return current;
      return {
        ...current,
        offset: String(
          round(
            Math.max(
              0,
              Math.min(wallLength(wall) - width, anchor.offset - width / 2),
            ),
          ),
        ),
      };
    });
  }, [anchor]);
  const opening = useMemo(
    () => ({
      wall_id: wallId,
      kind,
      offset: numeric(values.offset),
      width: numeric(values.width),
      height: numeric(values.height),
      bottom: kind === "window" ? numeric(values.bottom) : 0,
      ...(kind === "door"
        ? {
            door_leaf: values.door_leaf,
            hinge: values.hinge,
            swing: values.swing,
            angle: values.door_leaf ? numeric(values.angle) : 90,
          }
        : {}),
    }),
    [values, wallId, kind],
  );
  const errors = useMemo(
    () => validateOpening(layout, opening),
    [layout, opening],
  );
  useEffect(() => {
    onPreview({ opening, valid: errors.length === 0 });
  }, [opening, errors, onPreview]);
  const gaps = openingGaps(layout, wall);
  const largest = gaps.reduce(
    (best, gap) =>
      gap.end - gap.start > (best?.end - best?.start || 0) ? gap : best,
    null,
  );
  const change = (key, value) =>
    setValues((current) => ({ ...current, [key]: value }));
  const field = (label, key, min, max, unit = "m") => (
    <label className="edit-number">
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type="number"
          required
          step="any"
          min={min}
          max={max}
          value={values[key]}
          aria-invalid={
            !Number.isFinite(numeric(values[key])) ||
            numeric(values[key]) < min ||
            numeric(values[key]) > max
          }
          onChange={(event) => change(key, event.target.value)}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
  return (
    <div
      className="edit-section opening-composer"
      role="region"
      aria-label={`新增${openingNames[kind]}参数`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <h3 ref={heading} tabIndex={-1}>
        设置{openingNames[kind]}参数
      </h3>
      <p className="opening-wall-info">
        墙体 {layout.walls.indexOf(wall) + 1} · 长{" "}
        {wall ? round(wallLength(wall)) : "—"} m · 高 {wall?.height ?? "—"} m
      </p>
      <p className="field-note">
        图中虚线为待添加位置。可换墙或点击墙线定位，再调整下方参数。
      </p>
      <div className="edit-number-grid">
        {field("开口宽度", "width", 0.1, 60)}
        {field("开口高度", "height", 0.1, 4.5)}
        {field("距墙起点", "offset", 0, wall ? wallLength(wall) : 60)}
        {kind === "window" && field("窗台离地", "bottom", 0, 3)}
      </div>
      <div className="opening-space-info">
        <strong>
          可用墙段
          {largest
            ? ` · 最长 ${round(largest.end - largest.start)} m`
            : " · 暂无空位"}
        </strong>
        <p>
          {gaps.length
            ? gaps.map((gap) => `${gap.start}–${gap.end} m`).join("；")
            : "这面墙已被开口占满，请换墙或调整已有门窗。"}
        </p>
        <button
          className="secondary-button full-width"
          disabled={!largest || largest.end - largest.start < 0.1}
          onClick={() => {
            const width =
              Math.floor(
                Math.min(
                  Number.isFinite(opening.width) && opening.width >= 0.1
                    ? opening.width
                    : 0.9,
                  largest.end - largest.start,
                ) * 1000,
              ) / 1000;
            setValues((current) => ({
              ...current,
              width: String(width),
              offset: String(
                round(
                  largest.start +
                    Math.min(
                      0.05,
                      Math.max(0, (largest.end - largest.start - width) / 2),
                    ),
                ),
              ),
            }));
          }}
        >
          适配可用空位
        </button>
      </div>
      {kind === "door" && (
        <details className="opening-door-options">
          <summary>门扇与开启方式</summary>
          <label className="edit-label">
            门扇
            <select
              aria-label="门扇"
              value={values.door_leaf ? "on" : "off"}
              onChange={(e) => change("door_leaf", e.target.value === "on")}
            >
              <option value="on">安装门扇</option>
              <option value="off">仅保留门洞</option>
            </select>
          </label>
          {values.door_leaf && (
            <>
              <label className="edit-label">
                铰链位置
                <select
                  aria-label="铰链位置"
                  value={values.hinge}
                  onChange={(e) => change("hinge", e.target.value)}
                >
                  <option value="start">靠墙起点侧</option>
                  <option value="end">靠墙终点侧</option>
                </select>
              </label>
              <label className="edit-label">
                开启方向
                <select
                  aria-label="开启方向"
                  value={values.swing}
                  onChange={(e) => change("swing", e.target.value)}
                >
                  <option value="left">逆时针</option>
                  <option value="right">顺时针</option>
                </select>
              </label>
              {field("开启角度", "angle", 0, 110, "°")}
            </>
          )}
        </details>
      )}
      <div
        className={`opening-feedback ${errors.length ? "invalid" : "valid"}`}
        aria-live="polite"
      >
        {errors.length ? (
          errors.map((error) => <p key={error}>{error}</p>)
        ) : (
          <p>位置与尺寸可用，确认后添加到草稿。</p>
        )}
      </div>
      <div className="opening-composer-actions">
        <button className="secondary-button" onClick={onCancel}>
          取消添加
        </button>
        <button
          className="primary-button"
          disabled={!!errors.length}
          onClick={() => onAdd(opening)}
        >
          确认添加{openingNames[kind]}
        </button>
      </div>
      <p className="field-note">
        请先添加或取消，再保存结构。添加后仍可选中修改。
      </p>
    </div>
  );
}
