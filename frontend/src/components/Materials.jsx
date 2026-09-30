import { RotateCcw } from "lucide-react";
import { materials } from "../catalog.js";

const categories = { walls: "墙面", floor: "地板", fabric: "软装" };
export function Swatch({ material, selected, onSelect }) {
  return (
    <button
      className={`swatch ${selected ? "active" : ""}`}
      title={`${material.name} · ${material.sub}`}
      aria-label={`应用${material.name}`}
      aria-pressed={selected}
      onClick={() => onSelect(material)}
    >
      <span
        className={`chip ${material.texture ? "texture-" + material.texture : ""}`}
        style={{ "--swatch": material.color }}
      />
      <span className="label">{material.name}</span>
    </button>
  );
}
export function MaterialDock({ state, onSelect, onCategory }) {
  const ids =
    state.category === "walls"
      ? ["ivory", "sage", "gray", "linen", "blue", "gold", "rust", "charcoal"]
      : state.category === "floor"
        ? [
            "oak",
            "walnut",
            "honey",
            "sand",
            "gray",
            "cream",
            "ivory",
            "charcoal",
          ]
        : ["cream", "linen", "warm", "teal", "blue", "rust", "sage", "gray"];
  return (
    <section className="material-dock glass">
      <div className="dock-head">
        <div className="tabs" role="tablist">
          {Object.entries(categories).map(([id, name]) => (
            <button
              key={id}
              role="tab"
              className={state.category === id ? "active" : ""}
              aria-selected={state.category === id}
              onClick={() => onCategory(id)}
            >
              {name}
            </button>
          ))}
        </div>
        <button
          className="restore-material"
          disabled={!state.selected[state.category]}
          onClick={() => onSelect({ id: null }, state.category)}
        >
          <RotateCcw size={11} />
          还原材质
        </button>
      </div>
      <div id="dock-materials">
        {ids
          .map((id) => materials.find((m) => m.id === id))
          .map((m) => (
            <Swatch
              key={m.id}
              material={m}
              selected={state.selected[state.category] === m.id}
              onSelect={(m) => onSelect(m, state.category)}
            />
          ))}
      </div>
    </section>
  );
}
