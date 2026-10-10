import { useState } from "react";

export default function SurfaceTransfer({
  document,
  type,
  index,
  side = "both",
  onCommit,
}) {
  const [clipboard, setClipboard] = useState(null),
    [scope, setScope] = useState("selected");
  const source = document.layout[type][index];
  const read = (item) =>
    type === "rooms"
      ? item.floor_material
      : side === "both"
        ? item.wall_material
        : item[`material_${side}`] || item.wall_material;
  const apply = () =>
    onCommit((next) => {
      const current = read(source);
      next.layout[type].forEach((item, i) => {
        if (
          item.edit_locked ||
          (scope === "selected" && i !== index) ||
          (scope === "matching" && read(item) !== current)
        )
          return;
        if (type === "rooms") item.floor_material = clipboard.value;
        else if (side === "both") {
          item.wall_material = clipboard.value;
          item.material_left = null;
          item.material_right = null;
        } else item[`material_${side}`] = clipboard.value;
      });
      return next;
    }, false);
  return (
    <details className="surface-transfer">
      <summary>复制饰面 / 批量应用</summary>
      <p className="field-note">
        选中来源后取样，再选择目标对象粘贴。已锁定对象自动跳过，局部饰面保留。
      </p>
      <button
        type="button"
        onClick={() => setClipboard({ value: read(source) || null })}
      >
        取样当前饰面
      </button>
      <label className="edit-label">
        应用范围
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          aria-label="批量饰面范围"
        >
          <option value="selected">仅当前对象</option>
          <option value="matching">与当前对象相同基础饰面</option>
          <option value="all">
            全部{type === "rooms" ? "房间地板" : "墙体所选侧"}
          </option>
        </select>
      </label>
      <button type="button" disabled={!clipboard} onClick={apply}>
        粘贴饰面
      </button>
    </details>
  );
}
