import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Boxes,
  Search,
  RotateCcw,
  Download,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
import { api } from "../api.js";
import DiyPreview from "../diy/DiyPreview.jsx";
import "./library.css";
import { useLibraryPreferences } from "../hooks/useLibraryPreferences.js";
import MaterialLibrary from "./MaterialLibrary.jsx";
import { readContext, writeContext } from "../hooks/urlContext.js";

const sources = {
  all: "全部模型",
  builtin: "内置家具",
  imported: "导入素材",
  diy: "DIY 素材",
  generated: "户型方案",
  sample: "示例空间",
};
const bytes = (n) =>
  n == null
    ? "预览后读取"
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

function Thumbnail({ item }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.thumbnail_url]);
  return item.thumbnail_url && !failed ? (
    <img
      src={item.thumbnail_url}
      alt={item.name}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <>
      <Box size={32} />
      <span>GLB</span>
    </>
  );
}

export default function AssetLibrary({
  onEditDiy,
  onOpenJob,
  onCreate,
  onPlace,
  onClose,
  jobs = [],
  currentJobId = "",
  targetName = "",
  active = true,
  materialRooms = [],
  onApplyMaterial,
  materialTargetName,
  floorOnly = false,
  initialAssetType = "models",
  materialRoomId = "all",
}) {
  const contextKey = onClose
    ? `library-context:${currentJobId}`
    : "library-context:page";
  const [savedContext] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(contextKey)) || {};
      return onClose
        ? saved
        : {
            ...saved,
            assetType: readContext("assetType", saved.assetType),
            selectedId: readContext("libraryAsset", saved.selectedId),
            query: readContext("q", saved.query),
            source: readContext("librarySource", saved.source),
            category: readContext("category", saved.category),
          };
    } catch {
      return {};
    }
  });
  const importPicker = useRef(null);
  const [importUnit, setImportUnit] = useState("m");
  const [importRotation, setImportRotation] = useState("0");
  const [importing, setImporting] = useState(false);
  const preferences = useLibraryPreferences();
  const favorites = preferences.value.favorites || [];
  const [favoritesOnly, setFavoritesOnly] = useState(false),
    [archivedOnly, setArchivedOnly] = useState(false),
    [recentOnly, setRecentOnly] = useState(false);
  const [maxWidth, setMaxWidth] = useState("");
  const toggleFavorite = (id) => preferences.change("favorites", id);
  const [assetType, setAssetType] = useState(
    onClose ? initialAssetType : savedContext.assetType || initialAssetType,
  );
  const [targetId, setTargetId] = useState(currentJobId);
  const [placing, setPlacing] = useState(false),
    [placeError, setPlaceError] = useState("");
  const [scale, setScale] = useState("100");
  const placeLock = useRef(false);
  const pendingPlacement = useRef(null);
  useEffect(() => () => pendingPlacement.current?.abort(), []);
  useEffect(() => {
    if (!active) pendingPlacement.current?.abort();
  }, [active]);
  const [items, setItems] = useState([]),
    [selectedId, setSelectedId] = useState(savedContext.selectedId || null);
  const [query, setQuery] = useState(savedContext.query || ""),
    [source, setSource] = useState(savedContext.source || "all"),
    [sort, setSort] = useState(savedContext.sort || "source");
  const [category, setCategory] = useState(savedContext.category || "all");
  useEffect(() => {
    if (active && !onClose)
      writeContext({
        assetType,
        libraryAsset: selectedId,
        q: query,
        librarySource: source,
        category,
      });
  }, [active, onClose, assetType, selectedId, query, source, category]);
  useEffect(() => {
    if (active)
      try {
        sessionStorage.setItem(
          contextKey,
          JSON.stringify({
            assetType,
            selectedId,
            query,
            source,
            sort,
            category,
          }),
        );
      } catch {}
  }, [
    contextKey,
    active,
    assetType,
    selectedId,
    query,
    source,
    sort,
    category,
  ]);
  const categories = [
    ...new Set(
      items
        .filter((i) => source === "all" || i.source === source)
        .map((i) => i.category)
        .filter(Boolean),
    ),
  ];
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [info, setInfo] = useState(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api("/library/assets")
      .then((v) => {
        if (alive) setItems(v.items);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [revision]);
  const visible = useMemo(
    () =>
      items
        .filter(
          (i) =>
            (archivedOnly
              ? preferences.value.archived?.includes(i.id)
              : !preferences.value.archived?.includes(i.id)) &&
            (!recentOnly || preferences.value.recent?.includes(i.id)) &&
            (!maxWidth ||
              (i.dimensions && i.dimensions[0] <= Number(maxWidth))) &&
            (!favoritesOnly || favorites.includes(i.id)) &&
            (source === "all" || i.source === source) &&
            (category === "all" || i.category === category) &&
            `${i.name} ${i.filename} ${i.category || ""}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name, "zh-CN")
            : sort === "recent"
              ? (Date.parse(b.updated_at) || 0) -
                (Date.parse(a.updated_at) || 0)
              : a.source.localeCompare(b.source) ||
                a.name.localeCompare(b.name, "zh-CN"),
        ),
    [
      items,
      source,
      category,
      query,
      sort,
      favoritesOnly,
      favorites,
      archivedOnly,
      recentOnly,
      maxWidth,
      preferences.value,
    ],
  );
  const selected = visible.find((i) => i.id === selectedId) || visible[0];
  useEffect(() => {
    setPlaceError("");
    setScale("100");
  }, [selected?.id]);
  const place = async () => {
    if (placeLock.current || !selected) return;
    placeLock.current = true;
    const controller = new AbortController();
    pendingPlacement.current = controller;
    setPlacing(true);
    setPlaceError("");
    try {
      const ratio = Number(scale) / 100;
      if (!Number.isFinite(ratio) || ratio < 0.1 || ratio > 2)
        throw Error("放置比例需为 10–200%。");
      const template = await api("/library/placement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      for (const key of ["width", "depth", "height"]) template[key] *= ratio;
      await onPlace(template, targetId);
      preferences.change("recent", selected.id);
    } catch (e) {
      if (!controller.signal.aborted) setPlaceError(e.message);
    } finally {
      placeLock.current = false;
      setPlacing(false);
    }
  };
  useEffect(() => setInfo(null), [selected?.model_url]);
  return (
    <section className="asset-library-page" aria-label="素材库页面">
      <header className="diy-page-heading">
        <div>
          <span>三维资源管理</span>
          <h1>
            素材库{" "}
            <small>
              {assetType === "models" ? `${items.length} 个模型` : "装修材质"}
            </small>
          </h1>
          <p>家具、户型模型与装修材质，在这里统一选择。</p>
        </div>
        <div className="library-actions">
          <select
            aria-label="导入模型朝向"
            hidden={assetType !== "models"}
            value={importRotation}
            onChange={(e) => setImportRotation(e.target.value)}
          >
            {[0, 90, 180, 270].map((v) => (
              <option key={v} value={v}>
                旋转 {v}°
              </option>
            ))}
          </select>
          <select
            aria-label="导入模型单位"
            hidden={assetType !== "models"}
            value={importUnit}
            onChange={(e) => setImportUnit(e.target.value)}
          >
            <option value="m">模型单位：米</option>
            <option value="cm">模型单位：厘米</option>
            <option value="mm">模型单位：毫米</option>
          </select>
          <button
            className="secondary-button"
            disabled={importing}
            onClick={() => importPicker.current.click()}
            hidden={assetType !== "models"}
          >
            {importing ? "正在导入…" : "导入 GLB"}
          </button>
          <input
            ref={importPicker}
            hidden
            type="file"
            accept=".glb"
            onChange={async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              setImporting(true);
              setError("");
              try {
                const form = new FormData();
                form.append("file", file);
                form.append("unit", importUnit);
                form.append("rotation", importRotation);
                await api("/library/import", { method: "POST", body: form });
                setRevision((r) => r + 1);
                setSource("imported");
                setAssetType("models");
              } catch (e) {
                setError(e.message);
              } finally {
                setImporting(false);
                e.target.value = "";
              }
            }}
          />
          {onClose && (
            <button className="secondary-button" onClick={onClose}>
              返回人工设计
            </button>
          )}
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => setRevision((r) => r + 1)}
          >
            <RotateCcw size={14} />
            刷新素材
          </button>
          <button className="primary-button" onClick={onCreate}>
            <Sparkles size={14} />去 DIY 创作
          </button>
        </div>
      </header>
      <div className="library-tabs library-type-tabs" aria-label="素材类型">
        <button
          aria-pressed={assetType === "models"}
          onClick={() => setAssetType("models")}
        >
          三维模型
        </button>
        <button
          aria-pressed={assetType === "materials"}
          onClick={() => setAssetType("materials")}
        >
          装修材质
        </button>
      </div>
      {assetType === "materials" ? (
        <MaterialLibrary
          rooms={materialRooms}
          onApply={onApplyMaterial}
          targetName={materialTargetName || targetName || "当前方案"}
          floorOnly={floorOnly}
          initialRoomId={materialRoomId}
        />
      ) : (
        <>
          {preferences.error && (
            <p className="form-error">素材偏好同步失败：{preferences.error}</p>
          )}
          <div className="library-filters">
            <button
              aria-pressed={archivedOnly}
              onClick={() => setArchivedOnly(!archivedOnly)}
            >
              已归档
            </button>
            <button
              aria-pressed={recentOnly}
              onClick={() => setRecentOnly(!recentOnly)}
            >
              最近使用
            </button>
            <label>
              最大宽度{" "}
              <input
                aria-label="素材最大宽度（米）"
                type="number"
                min=".1"
                max="60"
                step=".1"
                value={maxWidth}
                placeholder="不限"
                onChange={(e) => setMaxWidth(e.target.value)}
                style={{ width: 75 }}
              />{" "}
              m
            </label>
            <button
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly(!favoritesOnly)}
            >
              {favoritesOnly ? "★ 我的收藏" : "☆ 只看收藏"}
            </button>
            <div className="library-tabs" aria-label="素材来源">
              {Object.entries(sources).map(([id, name]) => (
                <button
                  key={id}
                  aria-pressed={source === id}
                  onClick={() => {
                    setSource(id);
                    setCategory("all");
                  }}
                >
                  {name}
                  <small>
                    {id === "all"
                      ? items.length
                      : items.filter((i) => i.source === id).length}
                  </small>
                </button>
              ))}
            </div>
            <label className="library-search">
              <Search size={15} />
              <input
                type="search"
                aria-label="搜索 GLB 素材"
                placeholder="搜索名称或文件名"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="家具用途分类"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">全部用途</option>
              {categories.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="素材排序"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="source">按来源排列</option>
              <option value="recent">最近更新</option>
              <option value="name">按名称排列</option>
            </select>
          </div>
          {error && (
            <div className="diy-error" role="alert">
              {error}
              <button onClick={() => setRevision((r) => r + 1)}>重试</button>
            </div>
          )}
          {loading && <p role="status">正在读取本地素材…</p>}
          <div className="library-content">
            <div className="library-browser">
              <div className="library-result-label">
                找到 {visible.length} 个模型
              </div>
              <div className="library-cards" aria-label="GLB 素材列表">
                {visible.map((item) => (
                  <button
                    className="library-card"
                    key={item.id}
                    aria-pressed={selected?.id === item.id}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className={`library-card-symbol ${item.source}`}>
                      <Thumbnail item={item} />
                    </div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.category || sources[item.source]} ·{" "}
                      {bytes(item.size_bytes)}
                    </small>
                  </button>
                ))}
              </div>
              {!loading && !visible.length && (
                <div className="library-empty">
                  <Boxes size={36} />
                  <h2>没有匹配的模型</h2>
                  <p>换一个关键词或分类，也可以去 DIY 生成新素材。</p>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setQuery("");
                      setSource("all");
                      setCategory("all");
                    }}
                  >
                    查看全部模型
                  </button>
                </div>
              )}
            </div>
            <aside className="library-inspector">
              {selected ? (
                <>
                  <div className="library-selection">
                    <button
                      className="text-button"
                      disabled={!preferences.ready}
                      onClick={() =>
                        preferences.change("archived", selected.id)
                      }
                    >
                      {preferences.value.archived?.includes(selected.id)
                        ? "恢复到素材库"
                        : "归档素材"}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => toggleFavorite(selected.id)}
                    >
                      {favorites.includes(selected.id)
                        ? "★ 已收藏"
                        : "☆ 收藏素材"}
                    </button>
                    <span>{sources[selected.source]}</span>
                    <h2>{selected.name}</h2>
                    <p>{selected.filename}</p>
                  </div>
                  <DiyPreview
                    modelUrl={selected.model_url}
                    onInfo={setInfo}
                    frontDirection={
                      selected.source === "builtin" && selected.kind !== "model"
                        ? 1
                        : -1
                    }
                  />
                  <dl className="library-metadata">
                    <div>
                      <dt>宽 × 深 × 高</dt>
                      <dd>
                        {(info?.dimensions || selected.dimensions)
                          ?.map((n) => n.toFixed(2))
                          .join(" × ") || "等待预览读取"}
                        {(info || selected.dimensions) && " m"}
                      </dd>
                    </div>
                    <div>
                      <dt>文件大小</dt>
                      <dd>{bytes(info?.bytes ?? selected.size_bytes)}</dd>
                    </div>
                    <div>
                      <dt>网格 / 三角面</dt>
                      <dd>
                        {info
                          ? `${info.meshes} / ${info.triangles.toLocaleString()}`
                          : "等待预览读取"}
                      </dd>
                    </div>
                  </dl>
                  <div className="library-actions">
                    {selected.placeable && onPlace && (
                      <div className="library-placement">
                        {targetName ? (
                          <strong>放入：{targetName}</strong>
                        ) : (
                          <label>
                            目标方案
                            <select
                              aria-label="放入目标方案"
                              value={targetId}
                              disabled={placing}
                              onChange={(e) => setTargetId(e.target.value)}
                            >
                              <option value="">请选择已完成的户型</option>
                              {jobs
                                .filter((j) => j.status === "succeeded")
                                .map((j) => (
                                  <option key={j.id} value={j.id}>
                                    {j.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                        <label>
                          放置比例（%）
                          <input
                            aria-label="素材放置比例"
                            type="number"
                            min="10"
                            max="200"
                            value={scale}
                            disabled={placing}
                            onChange={(e) => setScale(e.target.value)}
                          />
                        </label>
                        <button
                          className="primary-button"
                          disabled={
                            placing ||
                            (!targetName &&
                              !jobs.some(
                                (j) =>
                                  j.id === targetId && j.status === "succeeded",
                              ))
                          }
                          onClick={place}
                        >
                          {placing ? "正在准备家具…" : "放入户型并编辑"}
                        </button>
                        {placeError && (
                          <p className="diy-error" role="alert">
                            {placeError}
                          </p>
                        )}
                        <small>
                          {selected.kind === "wall_television"
                            ? "自动寻找完整墙面，默认底部离地 1.05 米；可在人工设计中调整高度，保存后更新三维。"
                            : "自动寻找空位；放入后可移动、旋转、缩放，保存后更新三维。"}
                        </small>
                      </div>
                    )}
                    <a
                      className="secondary-button"
                      href={selected.model_url}
                      download={selected.filename}
                    >
                      <Download size={14} />
                      下载 GLB
                    </a>
                    {selected.source === "diy" && onEditDiy && (
                      <button
                        className="primary-button"
                        onClick={() => onEditDiy(selected.asset_id)}
                      >
                        <Sparkles size={14} />
                        编辑 DIY 部件
                      </button>
                    )}
                    {selected.source === "generated" && onOpenJob && (
                      <button
                        className="primary-button"
                        onClick={() => onOpenJob(selected.job_id)}
                      >
                        <ArrowUpRight size={14} />
                        打开方案
                      </button>
                    )}
                  </div>
                  <p className="library-note">
                    展示实际 GLB 网格及材质。DIY
                    素材支持部件编辑；家具放置在人工设计页完成。
                  </p>
                </>
              ) : (
                <div className="library-empty">
                  <Box size={40} />
                  <p>选择模型后，可旋转查看三维细节。</p>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
