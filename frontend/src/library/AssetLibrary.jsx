import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Boxes,
  Search,
  RotateCcw,
  Download,
  Sparkles,
  ArrowUpRight,
  Palette,
  Star,
  Clock3,
  SlidersHorizontal,
  Upload,
  Check,
} from "lucide-react";
import { api } from "../api.js";
import DiyPreview from "../diy/DiyPreview.jsx";
import OperationStatus from "../components/OperationStatus.jsx";
import "./library.css";
import "./libraryWorkspace.css";
import { useLibraryPreferences } from "../hooks/useLibraryPreferences.js";
import MaterialLibrary from "./MaterialLibrary.jsx";
import AssetManager from "./AssetManager.jsx";
import { readContext, writeContext } from "../hooks/urlContext.js";
import {
  matchesCatalog,
  catalogFacets,
  dimensionLabel,
} from "./catalogFilters.js";

const sources = {
  all: "全部模型",
  builtin: "官方家具",
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
            sort: readContext("librarySort", saved.sort),
            category: readContext("category", saved.category),
            family: readContext("family", saved.family),
            style: readContext("furnitureStyle", saved.style),
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
  const [materialCategory, setMaterialCategory] = useState(
    floorOnly ? "floor" : readContext("materialCategory", "walls"),
  );
  const [targetId, setTargetId] = useState(currentJobId);
  const [placing, setPlacing] = useState(false),
    [placeError, setPlaceError] = useState("");
  const [opening, setOpening] = useState(false),
    [openError, setOpenError] = useState("");
  const [openOrigin, setOpenOrigin] = useState("header");
  const openLock = useRef(false);
  const openAction = async (callback, origin = "header") => {
    if (openLock.current) return;
    openLock.current = true;
    setOpening(true);
    setOpenError("");
    setOpenOrigin(origin);
    try {
      await callback();
    } catch (error) {
      setOpenError(`打开失败：${error.message}`);
    } finally {
      openLock.current = false;
      setOpening(false);
    }
  };
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
    [source, setSource] = useState(savedContext.source || "builtin"),
    [sort, setSort] = useState(savedContext.sort || "source");
  const [category, setCategory] = useState(savedContext.category || "all");
  const [family, setFamily] = useState(savedContext.family || "all");
  const [style, setStyle] = useState(savedContext.style || "all");
  const inspector = useRef(null);
  const choose = (id) => {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 900px)").matches)
      inspector.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    else inspector.current?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const resetFilters = () => {
    setQuery("");
    setCategory("all");
    setFamily("all");
    setStyle("all");
    setMaxWidth("");
    setFavoritesOnly(false);
    setRecentOnly(false);
    setArchivedOnly(false);
  };
  useEffect(() => {
    if (active && !onClose)
      writeContext({
        assetType,
        libraryAsset: selectedId,
        q: query,
        librarySource: source,
        category,
        family,
        furnitureStyle: style,
        librarySort: sort,
      });
  }, [
    active,
    onClose,
    assetType,
    selectedId,
    query,
    source,
    sort,
    category,
    family,
    style,
  ]);
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
            family,
            style,
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
    family,
    style,
  ]);
  const {
    rooms: categories,
    families,
    styles,
  } = catalogFacets(items, source, category);
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
              ? i.archived || preferences.value.archived?.includes(i.id)
              : !i.archived && !preferences.value.archived?.includes(i.id)) &&
            (!recentOnly || preferences.value.recent?.includes(i.id)) &&
            (!favoritesOnly || favorites.includes(i.id)) &&
            matchesCatalog(i, {
              source,
              category,
              family,
              style,
              query,
              maxWidth,
            }),
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
      family,
      style,
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
  const [cardLimit, setCardLimit] = useState(48);
  useEffect(
    () => setCardLimit(48),
    [
      source,
      category,
      family,
      style,
      query,
      sort,
      favoritesOnly,
      archivedOnly,
      recentOnly,
      maxWidth,
    ],
  );
  const variants =
    selected?.family && selected.source === "builtin"
      ? items.filter(
          (i) =>
            i.source === "builtin" &&
            i.family === selected.family &&
            !preferences.value.archived?.includes(i.id),
        )
      : [];
  useEffect(() => {
    setPlaceError("");
    setOpenError("");
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
    <section
      className="asset-library-page library-workspace"
      aria-label="素材库页面"
    >
      <header className="diy-page-heading library-heading">
        <div className="library-title-group">
          <span className="creative-page-mark">
            <Boxes size={25} strokeWidth={1.5} />
          </span>
          <div>
            <h1>
              素材库{" "}
              <small>
                {assetType === "models" ? `${items.length} 个模型` : "装修材质"}
              </small>
            </h1>
          </div>
        </div>
        <div className="library-navigation">
          <div className="library-tabs library-type-tabs" aria-label="素材类型">
            <button
              aria-pressed={assetType === "models"}
              onClick={() => setAssetType("models")}
            >
              <Box size={16} />
              三维模型
            </button>
            <button
              aria-pressed={assetType === "materials"}
              onClick={() => setAssetType("materials")}
            >
              <Palette size={16} />
              装修材质
            </button>
          </div>
        </div>
        <div className="library-actions">
          <AssetManager onChange={() => setRevision((r) => r + 1)} />
          <details className="library-import" hidden={assetType !== "models"}>
            <summary>
              <Upload size={14} />
              导入素材
            </summary>
            <div>
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
            </div>
          </details>
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
                resetFilters();
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
          <button
            className="primary-button"
            disabled={!onCreate || opening}
            onClick={() =>
              openAction(() =>
                onCreate(
                  assetType === "materials"
                    ? floorOnly
                      ? "floor"
                      : materialCategory
                    : "furniture",
                ),
              )
            }
          >
            <Sparkles size={14} />
            {opening ? "正在打开…" : "去 DIY 创作"}
          </button>
        </div>
      </header>
      {openError && openOrigin === "header" && (
        <p className="diy-error" role="alert">
          {openError}
        </p>
      )}
      {assetType === "materials" ? (
        <MaterialLibrary
          rooms={materialRooms}
          onApply={onApplyMaterial}
          targetName={materialTargetName || targetName || "当前方案"}
          floorOnly={floorOnly}
          initialRoomId={materialRoomId}
          initialCategory={materialCategory}
          onCategoryChange={(category) => {
            setMaterialCategory(category);
            if (!onClose) writeContext({ materialCategory: category });
          }}
        />
      ) : (
        <>
          {preferences.error && (
            <p className="form-error" role="status">
              收藏已保留在当前页面，正在等待同步。
              <button className="text-button" onClick={preferences.reload}>
                重试同步
              </button>
            </p>
          )}
          <div className="library-filters library-model-filters">
            <div
              className="library-tabs library-source-tabs"
              aria-label="素材来源"
            >
              {Object.entries(sources).map(([id, name]) => (
                <button
                  key={id}
                  aria-pressed={source === id}
                  onClick={() => {
                    setSource(id);
                    setCategory("all");
                    setFamily("all");
                    setStyle("all");
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
            <div className="library-filter-main">
              <label className="library-search">
                <Search size={15} />
                <input
                  type="search"
                  aria-label="搜索 GLB 素材"
                  placeholder="搜家具、款式、空间，如：沙发 左贵妃"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <select
                aria-label="家具用途分类"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setFamily("all");
                  setStyle("all");
                }}
              >
                <option value="all">全部空间</option>
                {categories.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label="家具品类"
                value={family}
                onChange={(e) => setFamily(e.target.value)}
              >
                <option value="all">全部品类</option>
                {families.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <select
                aria-label="家具风格"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
              >
                <option value="all">全部风格</option>
                {styles.map((s) => (
                  <option key={s} value={s}>
                    {s}
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
            <div className="library-filter-options">
              <button
                aria-pressed={favoritesOnly}
                onClick={() => setFavoritesOnly(!favoritesOnly)}
              >
                <Star
                  size={14}
                  fill={favoritesOnly ? "currentColor" : "none"}
                />
                我的收藏
              </button>
              <details className="library-extra-filters">
                <summary>
                  <SlidersHorizontal size={14} />
                  更多筛选
                </summary>
                <div>
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
                    <Clock3 size={14} />
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
                </div>
              </details>
              <button className="text-button" onClick={resetFilters}>
                重置筛选
              </button>
            </div>
          </div>
          {error && (
            <div className="diy-error" role="alert">
              {error}
              <button onClick={() => setRevision((r) => r + 1)}>重试</button>
            </div>
          )}
          <OperationStatus
            active={loading}
            failed={!!error}
            successLabel="素材列表已更新"
            background={items.length > 0}
            label={items.length ? "正在刷新素材列表" : "正在读取本地素材"}
          />
          <div className="library-content">
            <div className="library-browser">
              <div className="library-result-label">
                <h2>
                  素材 <span>{visible.length}</span>
                </h2>
                <span>选择素材，查看三维细节</span>
              </div>
              <div className="library-cards" aria-label="GLB 素材列表">
                {visible.slice(0, cardLimit).map((item) => (
                  <button
                    className="library-card"
                    key={item.id}
                    aria-pressed={selected?.id === item.id}
                    onClick={() => choose(item.id)}
                  >
                    <div className={`library-card-symbol ${item.source}`}>
                      {selected?.id === item.id && (
                        <i className="library-card-check" aria-hidden="true">
                          <Check size={12} />
                        </i>
                      )}
                      <Thumbnail item={item} />
                    </div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.family || item.category || sources[item.source]} ·{" "}
                      {item.variant || sources[item.source]}
                    </small>
                    {item.dimensions && (
                      <span className="library-card-dimensions">
                        {dimensionLabel(item)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {visible.length > cardLimit && (
                <button
                  className="secondary-button"
                  onClick={() => setCardLimit((n) => n + 48)}
                >
                  加载更多素材（已显示 {Math.min(cardLimit, visible.length)} /{" "}
                  {visible.length}）
                </button>
              )}
              {!loading && !visible.length && (
                <div className="library-empty">
                  <Boxes size={36} />
                  <h2>没有匹配的模型</h2>
                  <p>换一个关键词或分类，也可以去 DIY 生成新素材。</p>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      resetFilters();
                      setSource("all");
                    }}
                  >
                    查看全部模型
                  </button>
                </div>
              )}
            </div>
            <aside className="library-inspector" ref={inspector}>
              {selected ? (
                <>
                  <div className="library-selection">
                    <div className="library-selection-actions">
                      <button
                        className="text-button"
                        disabled={!preferences.ready}
                        onClick={async () => {
                          if (selected.source !== "imported") {
                            preferences.change("archived", selected.id);
                            return;
                          }
                          try {
                            await api("/library/manage", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                id: selected.id,
                                archived: !(
                                  selected.archived ||
                                  preferences.value.archived?.includes(
                                    selected.id,
                                  )
                                ),
                              }),
                            });
                            if (
                              preferences.value.archived?.includes(selected.id)
                            )
                              preferences.change("archived", selected.id);
                            setRevision((r) => r + 1);
                          } catch (e) {
                            setError(e.message);
                          }
                        }}
                      >
                        {selected.archived ||
                        preferences.value.archived?.includes(selected.id)
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
                    </div>
                    <h2>{selected.name}</h2>
                    <p>
                      {selected.family
                        ? `${selected.category} / ${selected.family} / ${selected.variant}`
                        : selected.filename}
                    </p>
                    {["imported", "diy"].includes(selected.source) && (
                      <label className="library-ai-option">
                        <input
                          type="checkbox"
                          disabled={!preferences.ready || !!preferences.error}
                          checked={
                            preferences.value.aiEnabled?.includes(
                              selected.id,
                            ) || false
                          }
                          onChange={() =>
                            preferences.change("aiEnabled", selected.id)
                          }
                        />
                        允许 AI 自动使用此素材
                        <small>关闭后仍可手动放置，已有方案保留。</small>
                      </label>
                    )}
                  </div>
                  <DiyPreview
                    modelUrl={selected.model_url}
                    onInfo={setInfo}
                    frontDirection={selected.source === "builtin" ? 1 : -1}
                  />
                  {selected.description && (
                    <p className="library-description">
                      {selected.description}
                    </p>
                  )}
                  {variants.length > 1 && (
                    <section
                      className="library-variants"
                      aria-label="同类家具款式"
                    >
                      <header>
                        <strong>{selected.family} · 款式选择</strong>
                        <small>{variants.length} 款</small>
                      </header>
                      <div>
                        {variants.map((item) => (
                          <button
                            key={item.id}
                            aria-pressed={selected.id === item.id}
                            onClick={() => {
                              resetFilters();
                              setSource("builtin");
                              setFamily(item.family);
                              choose(item.id);
                            }}
                          >
                            <Thumbnail item={item} />
                            <span>
                              {item.variant}
                              <small>{dimensionLabel(item)}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
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
                          {placing ? "正在准备家具…" : "去户型选择位置"}
                        </button>
                        {placing && (
                          <div
                            className="asset-placement-feedback"
                            role="status"
                          >
                            正在准备所选家具，完成后进入户型选择位置。
                            <i
                              className="object-loading-rail"
                              aria-hidden="true"
                            />
                          </div>
                        )}
                        {placeError && (
                          <p className="diy-error" role="alert">
                            {placeError}
                          </p>
                        )}
                        <small>
                          {selected.kind === "wall_television"
                            ? "进入人工设计后点击墙边放置，自动贴合完整墙面；也可自动找空位。默认底部离地 1.05 米。"
                            : "进入人工设计后预览占地并点击放下，也可自动找空位。确认前不会添加，放下后仍可拖动和精调。"}
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
                        disabled={opening || !selected.asset_id}
                        onClick={() =>
                          openAction(
                            () => onEditDiy(selected.asset_id),
                            "selection",
                          )
                        }
                      >
                        <Sparkles size={14} />
                        编辑 DIY 部件
                      </button>
                    )}
                    {selected.source === "generated" && onOpenJob && (
                      <button
                        className="primary-button"
                        disabled={opening || !selected.job_id}
                        onClick={() =>
                          openAction(
                            () => onOpenJob(selected.job_id),
                            "selection",
                          )
                        }
                      >
                        <ArrowUpRight size={14} />
                        {opening ? "正在打开方案…" : "打开方案"}
                      </button>
                    )}
                  </div>
                  <p className="library-note">
                    {openError && openOrigin === "selection" && (
                      <span role="alert">
                        {openError}
                        <br />
                      </span>
                    )}
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
