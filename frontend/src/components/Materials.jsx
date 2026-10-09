import { RotateCcw } from "lucide-react";
import { materials, materialCategories } from "../catalog.js";

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
export function MaterialDock({
  state,
  onSelect,
  onCategory,
  rooms = [],
  onRoom,
  onSaveFloors,
}) {
  const ids = materialCategories[state.category] || [];
  const roomId = rooms.some((r) => r.id === state.floorTarget)
    ? state.floorTarget
    : "all";
  const selected =
    state.category === "floor" && roomId !== "all"
      ? Object.hasOwn(state.roomFloors || {}, roomId)
        ? state.roomFloors[roomId]
        : state.selected.floor
      : state.selected[state.category];
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
          disabled={!selected && !(state.category === "floor" && roomId === "all" && Object.keys(state.roomFloors || {}).length)}
          onClick={() => onSelect({ id: null }, state.category)}
        >
          <RotateCcw size={11} />
          还原材质
        </button>
      </div>
      {state.category === "floor" && (
        <label className="floor-room-picker">
          地板应用区域
          <select
            aria-label="地板应用区域"
            value={roomId}
            onChange={(e) => onRoom?.(e.target.value)}
          >
            <option value="all">全屋地板（统一替换）</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
          <small>
            {roomId === "all"
              ? "选择房间可单独铺设；全屋替换会清除各房间的单独配色。"
              : "仅更改所选区域，其他房间不受影响。"}
          </small>
        </label>
      )}
      <div id="dock-materials">
        {ids
          .map((id) => materials.find((m) => m.id === id))
          .map((m) => (
            <Swatch
              key={m.id}
              material={m}
              selected={selected === m.id}
              onSelect={(m) => onSelect(m, state.category)}
            />
          ))}
      </div>
      {state.category === "floor" && onSaveFloors && (
        <button className="secondary-button floor-save" onClick={onSaveFloors}>
          在人工设计中保存地板
        </button>
      )}
    </section>
  );
}
