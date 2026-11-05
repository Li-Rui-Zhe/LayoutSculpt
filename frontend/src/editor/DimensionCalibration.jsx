import { useState } from "react";
import {
  calibrate,
  differentDirection,
  referenceLength,
  dimensionStatus,
} from "./dimensions.js";

export function DimensionStatus({ layout }) {
  const status = dimensionStatus(layout);
  return (
    <details className="dimension-status">
      <summary>尺寸依据：{status.label}</summary>
      <p>{status.detail} 在墙体属性的“结构与校准”中填写参考长度。</p>
      {layout.dimension_basis?.anchors?.map((anchor) => (
        <p key={anchor.wall_id} className="field-note">
          参考墙 {anchor.wall_id}：{anchor.meters} m ·
          {anchor.source === "measured"
            ? "用户填写现场实测"
            : "用户填写图纸标注"}
        </p>
      ))}
    </details>
  );
}

export default function DimensionCalibration({ document, wall, onApply }) {
  const [length, setLength] = useState("");
  const [source, setSource] = useState("drawing");
  const [second, setSecond] = useState("");
  const [secondLength, setSecondLength] = useState("");
  const [message, setMessage] = useState("");
  const candidates = document.layout.walls.filter(
    (w) => !w.edit_hidden && w.id !== wall.id && differentDirection(wall, w),
  );
  return (
    <details className="edit-advanced">
      <summary>按参考长度校准平面尺寸</summary>
      <p>
        当前墙长 {referenceLength(wall).toFixed(3)}{" "}
        m。填写这段墙相同两端的长度，不要用房间净宽代替墙线长度。
      </p>
      <label className="edit-label">
        长度依据
        <select
          aria-label="校准长度依据"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="drawing">图纸标注</option>
          <option value="measured">现场实测</option>
        </select>
      </label>
      <label className="edit-label">
        参考墙实际长度（m）
        <input
          aria-label="参考墙实际长度"
          type="number"
          min="0.1"
          max="60"
          step="0.001"
          placeholder="填写已知长度"
          value={length}
          onChange={(e) => {
            setLength(e.target.value);
            setMessage("");
          }}
        />
      </label>
      <label className="edit-label">
        另一方向复核（可选）
        <select
          aria-label="另一方向参考墙"
          value={second}
          onChange={(e) => {
            setSecond(e.target.value);
            setSecondLength("");
            setMessage("");
          }}
        >
          <option value="">先按一段长度校准</option>
          {candidates.map((w) => (
            <option value={w.id} key={w.id}>
              {w.name || w.id} · 当前 {referenceLength(w).toFixed(3)} m
            </option>
          ))}
        </select>
      </label>
      {second && (
        <label className="edit-label">
          第二段实际长度（m）
          <input
            aria-label="第二段实际长度"
            type="number"
            min="0.1"
            max="60"
            step="0.001"
            value={secondLength}
            onChange={(e) => {
              setSecondLength(e.target.value);
              setMessage("");
            }}
          />
        </label>
      )}
      <p className="field-note">
        全屋平面与对象位置按比例调整；家具宽深高和所有高度保持不变。校准后请检查摆放，可撤销。
      </p>
      <button
        disabled={!length.trim() || (second && !secondLength.trim())}
        onClick={() => {
          try {
            const next = calibrate(
              document,
              referenceLength(wall),
              Number(length),
              {
                wallId: wall.id,
                source,
                secondWallId: second,
                secondActual: Number(secondLength),
              },
            );
            if (onApply(next) !== true)
              throw Error(
                "当前操作尚未完成，请结束拖动或等待保存完成后再校准。",
              );
            setMessage(
              "校准已应用，家具尺寸已保留。请检查摆放和其他墙段。全屋并未因此变成已实测。",
            );
          } catch (error) {
            setMessage(error.message);
          }
        }}
      >
        应用尺寸校准
      </button>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
