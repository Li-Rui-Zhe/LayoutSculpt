import { useState } from "react";
import { materials, materialCategories } from "../catalog.js";

const labels = { walls: "墙面", floor: "地板", fabric: "软装" };
export default function MaterialLibrary({
  rooms = [],
  onApply,
  targetName = "当前方案",
  floorOnly = false,
  initialRoomId = "all",
}) {
  const [category, setCategory] = useState(floorOnly ? "floor" : "walls");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [roomId, setRoomId] = useState(initialRoomId);
  const options = materials.filter(
    (m) =>
      materialCategories[category].includes(m.id) &&
      `${m.name} ${m.sub} ${m.color}`.includes(query.trim()),
  );
  const selected = options.find((m) => m.id === selectedId) || options[0];
  const target = rooms.some((r) => r.id === roomId) ? roomId : "all";
  return (
    <>
      <div className="library-filters">
        <div className="library-tabs" aria-label="材质用途">
          {Object.entries(labels)
            .filter(([id]) => !floorOnly || id === "floor")
            .map(([id, label]) => (
              <button
                key={id}
                aria-pressed={id === category}
                onClick={() => setCategory(id)}
              >
                {label}
              </button>
            ))}
        </div>
        <input
          className="material-search"
          aria-label="搜索材质与配色"
          placeholder="搜索颜色、纹理或名称"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="library-content">
        <div className="library-browser">
          <div className="library-result-label">
            {options.length} 款{labels[category]}材质 · 与工作台配色同步
          </div>
          <div className="library-cards" aria-label="材质与配色列表">
            {options.map((m) => (
              <button
                key={m.id}
                className="library-card material-card"
                aria-pressed={selected?.id === m.id}
                onClick={() => setSelectedId(m.id)}
              >
                <span
                  className={`material-sample texture-${m.texture || "plain"}`}
                  style={{ "--swatch": m.color }}
                />
                <strong>{m.name}</strong>
                <small>{m.sub}</small>
              </button>
            ))}
          </div>
          {!options.length && (
            <p className="library-empty">没有匹配的材质，请尝试其他关键词。</p>
          )}
        </div>
        <aside className="library-inspector material-inspector">
          {selected && (
            <>
              <div className="library-selection">
                <span>内置材质 · {labels[category]}</span>
                <h2>{selected.name}</h2>
                <p>{selected.sub}</p>
              </div>
              <div
                className={`material-large-sample texture-${selected.texture || "plain"}`}
                style={{ "--swatch": selected.color }}
              />
              <dl className="library-metadata">
                <div>
                  <dt>颜色</dt>
                  <dd>{selected.color.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>适用区域</dt>
                  <dd>
                    {Object.entries(materialCategories)
                      .filter(([, ids]) => ids.includes(selected.id))
                      .map(([id]) => labels[id])
                      .join(" / ")}
                  </dd>
                </div>
              </dl>
              {onApply && (
                <div className="library-placement">
                  <strong>{targetName}</strong>
                  {category === "floor" && (
                    <label>
                      应用区域
                      <select
                        aria-label="素材库地板应用区域"
                        value={target}
                        onChange={(e) => setRoomId(e.target.value)}
                      >
                        <option value="all">全屋地板（统一替换）</option>
                        {rooms.map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    className="primary-button"
                    onClick={() =>
                      onApply({
                        materialId: selected.id,
                        category,
                        roomId: target,
                      })
                    }
                  >
                    {floorOnly ? "应用到人工设计草稿" : "应用到当前预览"}
                  </button>
                  <small>
                    {category === "floor"
                      ? target === "all"
                        ? "全屋统一应用；选择具体房间可保留其他区域的地板。"
                        : "只修改所选房间的地板。"
                      : "应用于当前方案的同类表面。"}
                  </small>
                </div>
              )}
              <p className="library-note">
                {floorOnly
                  ? "应用后返回人工设计，点击保存三维方案即可写入模型。"
                  : "配色预览自动保存在本机。房间地板可转入人工设计，保存为独立三维方案。"}
              </p>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
