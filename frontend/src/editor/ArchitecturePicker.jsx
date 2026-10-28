import { BrickWall, DoorOpen, PanelsTopLeft, Route, Plus } from "lucide-react";
import { architectureItems } from "../library/architectureCatalog.js";
import "./architecturePicker.css";

export function architectureChoices(tool) {
  return architectureItems.filter((p) =>
    tool === "walls"
      ? !p.opening
      : tool === "passages"
        ? p.opening?.kind === "passage"
        : tool === "openings"
          ? p.opening && p.opening.kind !== "passage"
          : false,
  );
}

export default function ArchitecturePicker({
  tool,
  onChoose,
  replace = false,
  kind,
}) {
  const items = architectureChoices(tool).filter(
    (p) => !kind || p.opening?.kind === kind,
  );
  if (replace)
    return (
      <label className="edit-label">
        构件款式
        <select
          aria-label="更换构件款式"
          value=""
          onChange={(e) => onChoose(e.target.value)}
        >
          <option value="" disabled>
            选择款式，保留当前位置
          </option>
          {items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <section className="editor-architecture-picker" aria-label="选择建筑构件">
      <p className="field-note">
        {tool === "walls"
          ? "选款式后，在当前画布点击放置；放好后可拖动、旋转和调整尺寸。"
          : "选款式后，点击当前画布中的安装墙面；放好后可沿墙移动。"}
      </p>
      <div className="editor-architecture-grid">
        {items.map((p) => {
          const Icon =
            p.opening?.kind === "door"
              ? DoorOpen
              : p.opening?.kind === "window"
                ? PanelsTopLeft
                : p.opening
                  ? Route
                  : BrickWall;
          return (
            <button
              type="button"
              key={p.id}
              onClick={() => onChoose(p.id)}
              title={p.description}
            >
              <Icon size={21} />
              <strong>{p.name}</strong>
              <small>
                {p.opening
                  ? `宽 ${p.opening.width} · 高 ${p.height} m`
                  : `高 ${p.height} · 厚 ${p.thickness} m`}
              </small>
              <Plus size={12} className="architecture-add-mark" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
