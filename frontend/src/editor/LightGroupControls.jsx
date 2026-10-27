import { useState } from "react";
import { contains } from "./geometry.js";

export default function LightGroupControls({ document, index, onCommit }) {
  const [scope, setScope] = useState("group");
  const current = document.layout.lights[index];
  const room = document.layout.rooms.find((r) => contains(current, r.polygon));
  const matches = (l) =>
    scope === "all" ||
    (scope === "room"
      ? room && contains(l, room.polygon)
      : current.edit_group && l.edit_group === current.edit_group);
  const count = document.layout.lights.filter(
    (l) => matches(l) && !l.edit_locked,
  ).length;
  const apply = (values) =>
    onCommit((next) => {
      next.layout.lights.forEach((l) => {
        if (matches(l) && !l.edit_locked) Object.assign(l, values);
      });
      return next;
    }, false);
  return (
    <details className="edit-advanced">
      <summary>灯光分组与批量设置</summary>
      <label className="edit-label">
        灯组名称
        <input
          aria-label="灯组名称"
          maxLength={40}
          value={current.edit_group || ""}
          placeholder="例如：客厅主照明"
          onChange={(e) =>
            onCommit((next) => {
              next.layout.lights[index].edit_group = e.target.value || null;
              return next;
            }, false)
          }
        />
      </label>
      <label className="edit-label">
        作用范围
        <select
          aria-label="灯光批量范围"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="group">相同灯组</option>
          <option value="room" disabled={!room}>
            当前房间{room ? ` · ${room.name}` : ""}
          </option>
          <option value="all">全部灯具</option>
        </select>
      </label>
      <p className="field-note">
        将修改 {count} 盏灯，已锁定灯具跳过。保存三维方案后，可在设计预览查看灯光效果。
      </p>
      <div className="batch-toolbar">
        <button disabled={!count} onClick={() => apply({ enabled: true })}>
          整组开灯
        </button>
        <button disabled={!count} onClick={() => apply({ enabled: false })}>
          整组关灯
        </button>
        <button
          disabled={!count}
          onClick={() =>
            apply({ lumens: current.lumens, temperature: current.temperature })
          }
        >
          同步当前亮度与色温
        </button>
      </div>
    </details>
  );
}
