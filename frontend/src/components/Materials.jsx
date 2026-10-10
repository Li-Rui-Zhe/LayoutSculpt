import { RotateCcw } from "lucide-react";
import { materials, materialCategories } from "../catalog.js";
import MaterialSample from "./MaterialSample.jsx";
import { resolveMaterial } from "../materials/custom.js";

const categories = { walls: "墙面", floor: "地板" };
export function Swatch({ material, selected, onSelect }) {
  return (
    <button
      className={`swatch ${selected ? "active" : ""}`}
      title={`${material.name} · ${material.sub}`}
      aria-label={`应用${material.name}`}
      aria-pressed={selected}
      onClick={() => onSelect(material)}
    >
      <MaterialSample material={material} className="chip" />
      <span className="label">{material.name}</span>
      <small>
        {material.family === "软装搭配"
          ? material.sub.split(" · ")[0]
          : `${material.family} · ${material.finish}`}
      </small>
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
  const chosen = resolveMaterial(selected);
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
          disabled={
            !selected &&
            !(
              state.category === "floor" &&
              roomId === "all" &&
              Object.keys(state.roomFloors || {}).length
            )
          }
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
              ? "选择房间可单独铺设；全屋替换会统一各房间的地板。"
              : "仅更改所选区域，其他房间不受影响。"}
          </small>
        </label>
      )}
      <div className="material-guide">
        <strong>
          {state.category === "walls"
            ? "墙面饰面"
            : state.category === "floor"
              ? "地板与铺法"
              : "软装搭配"}
        </strong>
        <p>
          {state.category === "walls"
            ? "选择漆面、木饰面或墙布，预览表面纹理与光泽。"
            : state.category === "floor"
              ? "选择木地板、瓷砖或石材，纹理与铺装样式一起应用。"
              : "坐垫、靠枕、床品、窗帘与地毯分别搭配，保留层次。"}
        </p>
      </div>
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
      <div className="material-current" aria-live="polite">
        <span>当前{state.category === "fabric" ? "搭配" : "材质"}</span>
        <strong>{chosen?.name || "模型原始材质"}</strong>
        <p>
          {chosen?.usage ||
            (chosen
              ? "已保留的配色，可选择上方材质替换。"
              : "点击样板应用，可撤销或还原。")}
        </p>
      </div>
      {onSaveFloors && (
        <button className="secondary-button floor-save" onClick={onSaveFloors}>
          保存墙面与地板到设计版本
        </button>
      )}
    </section>
  );
}
