import { useRef, useState } from "react";
import { Search, Upload, Star, Check } from "lucide-react";
import { materials, materialCategories } from "../catalog.js";
import {
  loadCustomTextures,
  useCustomTextures,
} from "../materials/customTextures.js";
import { api } from "../api.js";
import { useLibraryPreferences } from "../hooks/useLibraryPreferences.js";
import MaterialSample from "../components/MaterialSample.jsx";

const labels = { walls: "墙面", floor: "地板", fabric: "软装" };
export default function MaterialLibrary({
  rooms = [],
  onApply,
  targetName = "当前方案",
  floorOnly = false,
  initialRoomId = "all",
  initialCategory = "walls",
  onCategoryChange,
}) {
  const textureStatus = useCustomTextures();
  const texturePicker = useRef(null);
  const [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState("");
  const prefs = useLibraryPreferences();
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [category, setCategory] = useState(
    floorOnly ? "floor" : initialCategory,
  );
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [roomId, setRoomId] = useState(initialRoomId);
  const options = materials.filter(
    (m) =>
      (!onlyFavorites || prefs.value.favorites?.includes(`material:${m.id}`)) &&
      materialCategories[category].includes(m.id) &&
      `${m.name} ${m.sub} ${m.family} ${m.usage}`.includes(query.trim()),
  );
  const selected = options.find((m) => m.id === selectedId) || options[0];
  const target = rooms.some((r) => r.id === roomId) ? roomId : "all";
  return (
    <>
      <input
        type="file"
        ref={texturePicker}
        hidden
        accept="image/png,image/jpeg,image/webp"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setUploading(true);
          setUploadError("");
          try {
            const form = new FormData();
            form.append("file", f);
            form.append("name", f.name.replace(/\.[^.]+$/, "").slice(0, 60));
            const material = await api("/materials/custom", {
              method: "POST",
              body: form,
            });
            await loadCustomTextures(true);
            setSelectedId(material.id);
          } catch (e) {
            setUploadError(e.message);
          } finally {
            setUploading(false);
          }
        }}
      />
      {uploadError && <p role="alert">{uploadError}</p>}
      {textureStatus.error && (
        <p role="alert">
          素材同步失败：{textureStatus.error}{" "}
          <button onClick={() => loadCustomTextures(true)}>重试</button>
        </p>
      )}
      {!!textureStatus.unavailable.length && (
        <p role="status">
          有 {textureStatus.unavailable.length}{" "}
          份材质记录损坏或贴图缺失，其他素材仍可正常使用。
        </p>
      )}
      <div className="library-filters library-material-filters">
        <button
          className="secondary-button"
          disabled={uploading}
          onClick={() => texturePicker.current.click()}
        >
          <Upload size={14} />
          {uploading ? "正在导入贴图…" : "导入贴图"}
        </button>
        <button
          className="material-favorite-button"
          aria-pressed={onlyFavorites}
          onClick={() => setOnlyFavorites(!onlyFavorites)}
        >
          <Star size={14} fill={onlyFavorites ? "currentColor" : "none"} />
          我的收藏
        </button>
        <div
          className="library-tabs library-material-tabs"
          aria-label="材质用途"
        >
          {Object.entries(labels)
            .filter(([id]) => (floorOnly ? id === "floor" : id !== "fabric"))
            .map(([id, label]) => (
              <button
                key={id}
                aria-pressed={id === category}
                onClick={() => {
                  setCategory(id);
                  onCategoryChange?.(id);
                }}
              >
                {label}
              </button>
            ))}
        </div>
        <label className="library-search">
          <Search size={15} />
          <input
            type="search"
            className="material-search"
            aria-label="搜索材质"
            placeholder="搜索木地板、瓷砖、木饰面、墙布"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="library-content">
        <div className="library-browser">
          <div className="library-result-label">
            <h2>
              {labels[category]}
              {category === "fabric" ? "搭配" : "材质"}{" "}
              <span>{options.length}</span>
            </h2>
            <span>为房间选一种喜欢的质感</span>
          </div>
          <div className="library-cards" aria-label="材质样板列表">
            {options.map((m) => (
              <button
                key={m.id}
                className="library-card material-card"
                aria-pressed={selected?.id === m.id}
                onClick={() => setSelectedId(m.id)}
              >
                <div className="library-material-swatch">
                  <MaterialSample material={m} className="material-sample" />
                  {selected?.id === m.id && (
                    <i className="library-card-check" aria-hidden="true">
                      <Check size={12} />
                    </i>
                  )}
                </div>
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
                <span>
                  {selected.recipe
                    ? "DIY 材质"
                    : selected.id.startsWith("texture:")
                      ? "自定义贴图"
                      : "内置材质"}{" "}
                  · {labels[category]}
                </span>
                <h2>{selected.name}</h2>
                <button
                  disabled={!prefs.ready}
                  onClick={() =>
                    prefs.change("favorites", `material:${selected.id}`)
                  }
                >
                  {prefs.value.favorites?.includes(`material:${selected.id}`)
                    ? "已收藏"
                    : "收藏此材质"}
                </button>
                <p>{selected.sub}</p>
              </div>
              <MaterialSample
                material={selected}
                className="material-large-sample"
              />
              <dl className="library-metadata">
                <div>
                  <dt>材质类型</dt>
                  <dd>{selected.family}</dd>
                </div>
                <div>
                  <dt>表面质感</dt>
                  <dd>{selected.finish}</dd>
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
              <p className="library-note">{selected.usage}</p>
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
                      : category === "fabric"
                        ? "按坐垫、靠枕、床品、窗帘与地毯分别搭配。"
                        : "应用于当前方案的墙面饰面。"}
                  </small>
                </div>
              )}
              <p className="library-note">
                {floorOnly
                  ? "应用后返回人工设计，点击保存三维方案即可写入模型。"
                  : "选材预览自动保存在本机。房间地板可转入人工设计，保存为独立三维方案。"}
              </p>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
