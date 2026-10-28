import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Check, ArrowRight } from "lucide-react";
import { api } from "../api.js";
import { toDraft, openingNames } from "../editor/geometry.js";
import { boundaryNames, isGlassBoundary } from "../editor/balcony.js";
import {
  architectureItems,
  architectureCategories,
  applyArchitecture,
  openingReference,
  architectureOpening,
} from "./architectureCatalog.js";
import ArchitecturePreview from "./ArchitecturePreview.jsx";
import "./architecture.css";

export default function ArchitectureLibrary({
  job,
  document: liveDocument,
  selectedWallId = "",
  onApply,
  refreshKey = 0,
}) {
  const [selected, setSelected] = useState(architectureItems[2]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [height, setHeight] = useState(selected.height);
  const [thickness, setThickness] = useState(selected.thickness);
  const [sill, setSill] = useState(selected.sill_height);
  const [width, setWidth] = useState(0.9),
    [bottom, setBottom] = useState(0);
  const [offset, setOffset] = useState("auto"),
    [angle, setAngle] = useState(75);
  const [hinge, setHinge] = useState("start"),
    [swing, setSwing] = useState("left");
  const [replaceKey, setReplaceKey] = useState("");
  const [wallId, setWallId] = useState(selectedWallId);
  const [loaded, setLoaded] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [runtime, setRuntime] = useState({
    ready: false,
    message: "正在检查门窗服务…",
  });
  useEffect(() => {
    let alive = true;
    api("/health")
      .then((health) => {
        if (alive)
          setRuntime({
            ready: health.capabilities?.includes("architecture_openings"),
            message:
              "新增门窗样式需要重启项目后端。重启后点击“刷新素材”即可安装，三维样板可先浏览。",
          });
      })
      .catch((e) => {
        if (alive) setRuntime({ ready: false, message: e.message });
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, retry]);
  const lock = useRef(false);
  const inspector = useRef(null);
  const eligible = job && ["succeeded", "awaiting_review"].includes(job.status);
  useEffect(() => {
    let alive = true;
    setLoaded(null);
    setLoadError("");
    if (!eligible || liveDocument) return;
    api(
      `/jobs/${job.id}/artifacts/${job.status === "awaiting_review" ? "structure" : "layout"}.json`,
    )
      .then((data) => {
        if (alive) setLoaded({ id: job.id, document: toDraft(data) });
      })
      .catch((e) => {
        if (alive) setLoadError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [job?.id, job?.status, liveDocument, retry, refreshKey]);
  useEffect(() => {
    setWallId(selectedWallId);
    setApplyError("");
  }, [job?.id, selectedWallId]);
  const document = eligible
    ? liveDocument || (loaded?.id === job.id ? loaded.document : null)
    : null;
  const walls = document?.layout.walls || [];
  const target = walls.find((w) => w.id === wallId);
  const isOpening = !!selected.opening;
  const previousOpening =
    replaceKey !== "" ? document?.layout.openings[Number(replaceKey)] : null;
  const glass =
    !isOpening &&
    isGlassBoundary({ boundary_type: selected.boundary_type || selected.id });
  const configuration = {
    preset_id: selected.id,
    boundary_type: selected.id,
    height,
    thickness,
    sill_height: glass ? sill : 0,
    ...(isOpening
      ? {
          width,
          bottom,
          offset: offset === "auto" ? undefined : offset,
          angle,
          hinge,
          swing,
          opening_ref: previousOpening
            ? openingReference(previousOpening)
            : undefined,
        }
      : {}),
  };
  const signature = JSON.stringify(configuration);
  useEffect(() => {
    setReplaceKey("");
    setOffset("auto");
    setApplyError("");
  }, [wallId, job?.id, selected.id]);
  const resolvedOpening = useMemo(() => {
    if (!isOpening || !document || !target) return null;
    try {
      return architectureOpening(document, target.id, configuration).opening;
    } catch {
      return null;
    }
  }, [document, target, signature]);
  const validation = useMemo(() => {
    if (!document || !target) return "";
    try {
      applyArchitecture(document, target.id, configuration);
      return "";
    } catch (e) {
      return e.message;
    }
  }, [document, target, signature]);
  const visible = architectureItems.filter(
    (i) =>
      (category === "all" || i.category === category) &&
      `${i.name} ${i.sub} ${i.description}`.includes(query.trim()),
  );
  const choose = (item) => {
    setSelected(item);
    setHeight(item.height);
    setThickness(item.thickness);
    setSill(item.sill_height);
    if (item.opening) {
      setWidth(item.opening.width);
      setBottom(item.opening.bottom);
      setAngle(item.opening.angle ?? 75);
      setHinge("start");
      setSwing("left");
    }
    setOffset("auto");
    setReplaceKey("");
    setApplyError("");
    if (matchMedia("(max-width: 900px)").matches)
      inspector.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const apply = async () => {
    if (
      lock.current ||
      !document ||
      !target ||
      !onApply ||
      (isOpening && !runtime.ready)
    )
      return;
    lock.current = true;
    setApplying(true);
    setApplyError("");
    try {
      applyArchitecture(document, target.id, configuration);
      await onApply({ wallId: target.id, configuration });
    } catch (e) {
      setApplyError(e.message);
    } finally {
      lock.current = false;
      setApplying(false);
    }
  };
  return (
    <>
      <div className="library-filters architecture-filters">
        <label className="library-search">
          <Search size={15} />
          <input
            type="search"
            aria-label="搜索建筑构件"
            placeholder="搜索门、窗、墙体、通道、阳台围护"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="library-tabs" aria-label="建筑构件分类">
          {architectureCategories.map(([id, name]) => (
            <button
              key={id}
              aria-pressed={category === id}
              onClick={() => setCategory(id)}
            >
              {name}
              <small>
                {id === "all"
                  ? architectureItems.length
                  : architectureItems.filter((item) => item.category === id)
                      .length}
              </small>
            </button>
          ))}
        </div>
      </div>
      <div className="library-content architecture-content">
        <div className="library-browser">
          <div className="library-result-label">
            <h2>
              建筑构件 <span>{visible.length}</span>
            </h2>
            <span>墙体、门窗、通道与阳台围护</span>
          </div>
          <div
            className="library-cards architecture-cards"
            aria-label="建筑构件列表"
          >
            {visible.map((item) => (
              <button
                key={item.id}
                className="library-card architecture-card"
                aria-pressed={selected.id === item.id}
                onClick={() => choose(item)}
              >
                <div className="architecture-card-model">
                  <ArchitecturePreview
                    type={item.boundary_type || item.id}
                    height={item.height}
                    thickness={item.thickness}
                    sillHeight={item.sill_height}
                    opening={item.opening}
                    label={`${item.name}三维样板`}
                  />
                  {selected.id === item.id && (
                    <i className="library-card-check" aria-hidden="true">
                      <Check size={12} />
                    </i>
                  )}
                </div>
                <strong>{item.name}</strong>
                <small>{item.sub}</small>
                <span className="library-card-dimensions">
                  {item.opening
                    ? `${item.opening.width.toFixed(2)} × ${item.height.toFixed(2)} m${item.opening.kind === "window" ? ` · 窗台 ${item.opening.bottom.toFixed(2)} m` : ""}`
                    : `总高 ${item.height.toFixed(2)} m · 长度随墙段适配`}
                </span>
              </button>
            ))}
          </div>
          {!visible.length && (
            <p className="library-empty">
              没有匹配的建筑构件，请尝试其他分类或关键词。
            </p>
          )}
          <p className="library-note architecture-guidance">
            选择构件后可旋转查看。门窗与通道按尺寸安装到墙上，支持新增或替换；墙体围护按原墙段长度适配。
          </p>
        </div>
        <aside
          ref={inspector}
          className="library-inspector architecture-inspector"
        >
          <div className="library-selection">
            <span>建筑构件 · {selected.category}</span>
            <h2>{selected.name}</h2>
            <p>{selected.description}</p>
          </div>
          <ArchitecturePreview
            type={selected.boundary_type || selected.id}
            height={height}
            thickness={thickness}
            sillHeight={sill}
            opening={
              isOpening
                ? {
                    ...selected.opening,
                    width,
                    height,
                    bottom: selected.opening.kind === "window" ? bottom : 0,
                    angle,
                    hinge,
                    swing,
                  }
                : undefined
            }
            interactive
            label={`${selected.name}可旋转三维预览`}
          />
          <div className="architecture-dimensions">
            <label>
              {isOpening ? "开口高度（m）" : "围护总高（m）"}
              <input
                aria-label={isOpening ? "构件开口高度" : "构件围护总高"}
                type="number"
                min={isOpening ? "0.1" : "0.3"}
                max="4.5"
                step="0.05"
                value={height}
                onChange={(e) =>
                  setHeight(e.target.value === "" ? "" : Number(e.target.value))
                }
              />
            </label>
            {isOpening ? (
              <label>
                开口宽度（m）
                <input
                  aria-label="构件开口宽度"
                  type="number"
                  min="0.1"
                  max="60"
                  step="0.05"
                  value={width}
                  onChange={(e) =>
                    setWidth(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                />
              </label>
            ) : (
              <label>
                围护厚度（m）
                <input
                  aria-label="构件围护厚度"
                  type="number"
                  min="0.06"
                  max="0.6"
                  step="0.01"
                  value={thickness}
                  onChange={(e) =>
                    setThickness(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                />
              </label>
            )}
            {isOpening && selected.opening.kind === "window" && (
              <label>
                窗台离地（m）
                <input
                  aria-label="构件窗台离地"
                  type="number"
                  min="0"
                  max="3"
                  step="0.05"
                  value={bottom}
                  onChange={(e) =>
                    setBottom(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                />
              </label>
            )}
            {isOpening && (
              <label>
                距墙起点（m）
                <input
                  aria-label="构件距墙起点"
                  type="number"
                  min="0"
                  max="60"
                  step="0.05"
                  value={offset === "auto" ? "" : offset}
                  placeholder="自动适配空位"
                  onChange={(e) =>
                    setOffset(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                />
                <button
                  className="text-button"
                  onClick={() => setOffset("auto")}
                >
                  适配可用空位
                </button>
              </label>
            )}
            {isOpening &&
              selected.opening.kind === "door" &&
              selected.opening.door_style !== "sliding" && (
                <>
                  <label>
                    开启角度（°）
                    <input
                      aria-label="构件门扇开启角度"
                      type="number"
                      min="0"
                      max="110"
                      step="5"
                      value={angle}
                      onChange={(e) =>
                        setAngle(
                          e.target.value === "" ? "" : Number(e.target.value),
                        )
                      }
                    />
                  </label>
                  <label>
                    开启方向
                    <select
                      aria-label="构件开启方向"
                      value={swing}
                      onChange={(e) => setSwing(e.target.value)}
                    >
                      <option value="left">向 A 侧开启</option>
                      <option value="right">向 B 侧开启</option>
                    </select>
                  </label>
                  {selected.opening.door_style === "hinged" && (
                    <label>
                      铰链位置
                      <select
                        aria-label="构件铰链位置"
                        value={hinge}
                        onChange={(e) => setHinge(e.target.value)}
                      >
                        <option value="start">靠墙起点</option>
                        <option value="end">靠墙终点</option>
                      </select>
                    </label>
                  )}
                </>
              )}
            {glass && (
              <label>
                实体基座（m）
                <input
                  aria-label="构件实体基座高度"
                  type="number"
                  min="0"
                  max={Math.max(0, Number(height) - 0.05)}
                  step="0.05"
                  value={sill}
                  onChange={(e) =>
                    setSill(e.target.value === "" ? "" : Number(e.target.value))
                  }
                />
              </label>
            )}
          </div>
          <p className="library-note">
            {isOpening
              ? "开口按填写的宽高安装，自动检查墙高、边界和已有门窗。尺寸请按实际核对。"
              : "样板宽 2.40 m，应用时随墙段适配。高度为可修改初值，请按实际核对。"}
          </p>
          <div className="library-placement architecture-placement">
            <strong>{job?.name || "选择目标方案"}</strong>
            {eligible ? (
              <>
                <label>
                  应用墙段
                  <select
                    aria-label="建筑构件应用墙段"
                    value={target?.id || ""}
                    onChange={(e) => {
                      setWallId(e.target.value);
                      setApplyError("");
                    }}
                    disabled={!document || applying}
                  >
                    <option value="">请选择要调整的墙段</option>
                    {walls.map((wall, index) => (
                      <option key={wall.id} value={wall.id}>
                        墙体 {index + 1} · {wall.id} ·{" "}
                        {boundaryNames[wall.boundary_type || "wall"]} ·{" "}
                        {Math.hypot(
                          wall.end.x - wall.start.x,
                          wall.end.y - wall.start.y,
                        ).toFixed(2)}{" "}
                        m
                      </option>
                    ))}
                  </select>
                </label>
                {isOpening && target && (
                  <label>
                    安装方式
                    <select
                      aria-label="建筑构件安装方式"
                      value={replaceKey}
                      onChange={(e) => {
                        setReplaceKey(e.target.value);
                        setApplyError("");
                        const old =
                          e.target.value !== ""
                            ? document.layout.openings[Number(e.target.value)]
                            : null;
                        if (old) {
                          setOffset(old.offset);
                          setWidth(old.width);
                          setHeight(old.height);
                          setBottom(
                            selected.opening.kind === "window" ? old.bottom : 0,
                          );
                          setAngle(old.angle ?? selected.opening.angle ?? 75);
                          setHinge(old.hinge || "start");
                          setSwing(old.swing || "left");
                        } else setOffset("auto");
                      }}
                    >
                      <option value="">新增门窗或通道</option>
                      {document.layout.openings.map((o, i) =>
                        o.wall_id === target.id ? (
                          <option key={o.edit_id || i} value={String(i)}>
                            替换{openingNames[o.kind]} {i + 1} · 宽{" "}
                            {o.width.toFixed(2)} m · 距起点{" "}
                            {o.offset.toFixed(2)} m
                          </option>
                        ) : null,
                      )}
                    </select>
                  </label>
                )}
                {!document && !loadError && (
                  <small role="status">正在读取方案墙段…</small>
                )}
                {loadError && (
                  <p role="alert">
                    {loadError}
                    <button
                      className="text-button"
                      onClick={() => setRetry((r) => r + 1)}
                    >
                      重新读取
                    </button>
                  </p>
                )}
                {target && (
                  <small>
                    {isOpening
                      ? `安装墙高 ${target.height.toFixed(2)} m${resolvedOpening && !validation ? ` · 开口距起点 ${resolvedOpening.offset.toFixed(2)} m` : ""}；${previousOpening ? "替换所选开口" : "新增独立开口"}。`
                      : `当前总高 ${target.height.toFixed(2)} m → ${Number(height).toFixed(2)} m；其他墙段保留原样。`}
                  </small>
                )}
                {(validation || applyError) && (
                  <p className="form-error" role="alert">
                    {applyError || validation}
                  </p>
                )}
                {isOpening && !runtime.ready && (
                  <p className="library-note" role="status">
                    {runtime.message}
                  </p>
                )}
                <button
                  className="primary-button"
                  disabled={
                    !onApply ||
                    !target ||
                    !!validation ||
                    applying ||
                    (isOpening && !runtime.ready)
                  }
                  onClick={apply}
                >
                  <ArrowRight size={15} />
                  {applying
                    ? "正在应用…"
                    : isOpening
                      ? previousOpening
                        ? "替换选中开口"
                        : "安装到选中墙段"
                      : "应用到选中墙段"}
                </button>
                <small>
                  应用到人工设计草稿，可撤销；保存生成后更新正式模型。
                </small>
              </>
            ) : (
              <p className="library-note">
                打开一个已识别或已完成的方案，即可选择墙段应用。现在可以先浏览、旋转和调整样板。
              </p>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
