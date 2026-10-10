import { useState } from "react";
import NumberField from "../editor/NumberField.jsx";
import { normalizeGroup, transformPartGroup } from "./partGroups.js";

export default function GroupTransform({ design, group, onCommit, onError }) {
  const [offset, setOffset] = useState({ x: 0, y: 0, z: 0 }),
    [angle, setAngle] = useState(15),
    [scale, setScale] = useState(100);
  const path = normalizeGroup(group);
  const ancestors = path.split("/").map((_, i) =>
    path
      .split("/")
      .slice(0, i + 1)
      .join("/"),
  );
  const [scope, setScope] = useState(path);
  const target = ancestors.includes(scope) ? scope : path;
  const apply = (operation, value) => {
    try {
      onCommit(transformPartGroup(design, target, operation, value));
      onError("");
    } catch (e) {
      onError(e.message);
    }
  };
  return (
    <details className="edit-advanced">
      <summary>整组移动、旋转与缩放</summary>
      <label>
        变换层级
        <select
          aria-label="变换分组层级"
          value={target}
          onChange={(e) => setScope(e.target.value)}
        >
          {ancestors.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </label>
      <p className="field-note">
        包含所选层级的全部子组。含锁定部件时拒绝操作；旋转以组合中心为轴，缩放保持底部高度。
      </p>
      <div className="edit-number-grid">
        {[
          ["x", "左右位移"],
          ["y", "前后位移"],
          ["z", "上下位移"],
        ].map(([key, label]) => (
          <NumberField
            key={key}
            label={`整组${label}`}
            value={offset[key]}
            min={-6}
            max={6}
            onCommit={(v) => setOffset((p) => ({ ...p, [key]: v }))}
          />
        ))}
      </div>
      <button
        className="secondary-button"
        onClick={() => apply("move", offset)}
      >
        应用整组位移
      </button>
      <NumberField
        label="整组旋转角度"
        unit="°"
        min={-360}
        max={360}
        value={angle}
        onCommit={setAngle}
      />
      <button
        className="secondary-button"
        onClick={() => apply("rotate", angle)}
      >
        应用整组旋转
      </button>
      <NumberField
        label="整组缩放比例"
        unit="%"
        min={10}
        max={300}
        value={scale}
        onCommit={setScale}
      />
      <button
        className="secondary-button"
        onClick={() => apply("scale", scale / 100)}
      >
        应用整组缩放
      </button>
    </details>
  );
}
