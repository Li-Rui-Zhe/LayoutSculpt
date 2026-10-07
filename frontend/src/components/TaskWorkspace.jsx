import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Box,
  Image,
  ListChecks,
  FolderDown,
  Download,
  Camera,
  Focus,
  Scan,
  Undo2,
  Redo2,
  Plus,
  Minus,
  Maximize,
  LoaderCircle,
  Check,
  ArrowUpRight,
  RotateCcw,
  Square,
  FileJson,
  FileBox,
  Sun,
  Moon,
  SlidersHorizontal,
  Upload,
  Info,
  ArrowRight,
  PencilRuler,
  TriangleAlert,
  X,
} from "lucide-react";
import Viewport from "./Viewport.jsx";
import Modal from "./Modal.jsx";
import { MaterialDock } from "./Materials.jsx";
import { useStudio, initialStudio } from "../hooks/useStudio.js";
import { effortLabel } from "../hooks/useModels.js";
import { presets, showcase } from "../catalog.js";
import { terminal } from "../api.js";
import { StatusBadge } from "./TaskRail.jsx";
import ManualEditor from "../editor/ManualEditor.jsx";
import StructureReview from "./StructureReview.jsx";
import RetryDialog from "./RetryDialog.jsx";
import { generationError } from "../hooks/modelSelection.js";

const lightIcons = {
  midday: Sun,
  night: Moon,
};
const defaultSettings = {
  shadows: true,
  rotate: false,
  grid: false,
  cutaway: true,
};
export function IconButton({ label, icon: Icon, onClick, disabled, active }) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={16} />
    </button>
  );
}
function stagesFor(job) {
  if (job?.restructure_of)
    return [
      ["读取原图与现有结构", 5],
      ["复核墙体与门窗", 40],
      ["规划家具布置", 58],
      ["构建三维模型", 82],
      ["成果交付", 100],
    ];
  if (job?.refine_of)
    return [
      ["保留原户型结构", 5],
      ["重新规划家具", 58],
      ["构建三维模型", 82],
      ["成果交付", 100],
    ];
  if (job?.edited_of)
    return [
      ["读取人工设计", 5],
      ["生成三维版本", 82],
      ["成果交付", 100],
    ];
  return job?.rebuild_of
    ? [
        ["复用户型布局", 5],
        ["更新三维效果", 82],
        ["成果交付", 100],
      ]
    : [
        ["识别户型结构", 12],
        ...(job?.options.collaboration !== false ? [["复核空间关系", 40]] : []),
        ["规划家具布置", 58],
        ["构建三维模型", 82],
        ["成果交付", 100],
      ];
}
function Pipeline({ job }) {
  const steps = stagesFor(job);
  return (
    <ol className="task-pipeline">
      {steps.map(([name, threshold], index) => {
        const reviewIncomplete =
          threshold === 40 &&
          ["timed_out", "incomplete"].includes(job?.result?.ai_review?.status);
        const done =
          job?.status === "succeeded" ||
          job?.progress >= (steps[index + 1]?.[1] ?? 100);
        const active = !done && job?.progress >= threshold;
        return (
          <li
            key={name}
            className={
              reviewIncomplete
                ? "review-incomplete"
                : done
                  ? "done"
                  : active
                    ? "current"
                    : ""
            }
          >
            <span>
              {reviewIncomplete ? (
                <TriangleAlert size={13} />
              ) : done ? (
                <Check size={13} />
              ) : (
                String(index + 1).padStart(2, "0")
              )}
            </span>
            <b>{reviewIncomplete ? "AI 复核未完成，需人工核对" : name}</b>
            {active && !reviewIncomplete && job.status === "running" && (
              <LoaderCircle size={12} className="spin" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
function Activity({ job, events }) {
  return (
    <section className="activity-page">
      <div className="section-heading">
        <h2>生成记录</h2>
        <StatusBadge status={job.status} />
      </div>
      <Pipeline job={job} />
      <div className="activity-intro">
        <p>任务 #{job.id.slice(0, 8).toUpperCase()}</p>
        <span>
          {job.stage} · {job.progress}%
        </span>
      </div>
      <div className="activity-list" aria-live="polite">
        {events.length ? (
          events.map((event) => (
            <div key={event.id}>
              <span className="activity-dot" />
              <time>
                {new Date(event.created_at).toLocaleTimeString("zh-CN")}
              </time>
              <div>
                {event.agent && <b>{event.agent}</b>}
                <p>{generationError(event.message)}</p>
              </div>
            </div>
          ))
        ) : (
          <div className="muted">正在同步本任务的生成记录…</div>
        )}
      </div>
      {job.error && (
        <div className="form-error" role="alert">
          {generationError(job.error)}
        </div>
      )}
    </section>
  );
}
function Deliverables({ job, onCapture }) {
  if (job?.status !== "succeeded" || !job?.result?.model_url)
    return (
      <div className="empty-state">
        <FolderDown size={38} />
        <h2>成果将在这里汇集</h2>
        <p>生成完成后，可以下载三维模型、工程文件和户型数据。</p>
      </div>
    );
  const result = job.result;
  return (
    <section className="deliverables-page">
      <div className="delivery-hero">
        <span className="delivery-mark">
          <Check size={24} />
        </span>
        <div>
          <span className="eyebrow">你的空间，已准备就绪</span>
          <h2>从设计到交付，一处完成。</h2>
          <p>
            {result.room_count} 个空间 · {result.area} ㎡ · 独立成果包
          </p>
        </div>
      </div>
      <div className="deliverable-grid">
        {[
          [
            FileBox,
            "三维模型",
            "GLB",
            "可在三维软件中查看和继续使用",
            result.model_url,
          ],
          ...(result.blend_url
            ? [
                [
                  Box,
                  "Blender 工程",
                  "BLEND",
                  "包含模型、家具与打包贴图",
                  result.blend_url,
                ],
              ]
            : []),
          [
            FileJson,
            "户型结构数据",
            "JSON",
            "房间、墙体、门窗与家具布局",
            result.layout_url,
          ],
          [
            ListChecks,
            "生成清单",
            "JSON",
            "模型参数、识别说明与成果索引",
            `/api/jobs/${job.id}/artifacts/manifest.json`,
          ],
          ...(result.quality_url
            ? [
                [
                  ListChecks,
                  "设计检查",
                  "JSON",
                  "家具碰撞检查、照明配置与改进记录",
                  result.quality_url,
                ],
              ]
            : []),
          ...(result.consistency_url
            ? [
                [
                  ListChecks,
                  "结构一致性",
                  "JSON",
                  "墙体、门窗、地板和轮廓的校验记录",
                  result.consistency_url,
                ],
              ]
            : []),
        ].map(([Icon, title, type, desc, url]) => (
          <a className="deliverable-card" key={title} href={url} download>
            <Icon size={25} strokeWidth={1.4} />
            <span className="file-type">{type}</span>
            <h3>{title}</h3>
            <p>{desc}</p>
            <span className="download-label">
              下载文件 <Download size={14} />
            </span>
          </a>
        ))}
      </div>
      <div className="delivery-tip">
        <Info size={16} />
        <p>
          模型与工程保留生成时的材质。工作区的光照、配色调整可通过「导出效果图」保存为图片。
        </p>
        <button className="text-button" onClick={onCapture}>
          前往设计预览 <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}

// 外观、撤销和导出按任务隔离，渲染器由应用复用。
export default function TaskWorkspace({
  job,
  projects,
  onCreate,
  active = true,
  headingHost,
}) {
  const id = job?.id || "sample";
  const { state, update, undo, redo, canUndo, canRedo, storageError } =
    useStudio(id);
  const hasModel = !job || job.status === "succeeded";
  const reviewing = job?.status === "awaiting_review";
  const [tab, setTab] = useState(hasModel ? "design" : "activity");
  const [panel, setPanel] = useState(hasModel ? "overview" : "task");
  const [inspectorOpen, setInspectorOpen] = useState(
    () => !matchMedia("(max-width: 1000px)").matches,
  );
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 1000px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(max-width: 1000px)");
    const change = () => {
      setMobile(media.matches);
      setInspectorOpen(!media.matches);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!inspectorOpen || !active) return;
    const close = (event) => {
      if (event.key === "Escape") {
        setInspectorOpen(false);
        host.current
          ?.querySelector('.workspace-tools button[aria-expanded="true"]')
          ?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [inspectorOpen, active]);
  const [loading, setLoading] = useState(true);
  const [modelError, setModelError] = useState("");
  const [zoom, setZoom] = useState(100);
  const [thumbs, setThumbs] = useState({});
  const [view, setView] = useState("perspective");
  const [capture, setCapture] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [imported, setImported] = useState(null);
  const [notice, setNotice] = useState("");
  const [improving, setImproving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [improvement, setImprovement] = useState("restructure");
  const [captureRequested, setCaptureRequested] = useState(false);
  const actionLock = useRef(false);
  const previousStatus = useRef(job?.status);
  useEffect(() => {
    if (job?.status !== previousStatus.current) {
      setTab(
        job?.status === "succeeded"
          ? "design"
          : job?.status === "awaiting_review"
            ? "review"
            : "activity",
      );
      setPanel(job?.status === "succeeded" ? "overview" : "task");
      setInspectorOpen(!matchMedia("(max-width: 1000px)").matches);
      previousStatus.current = job?.status;
    }
  }, [job?.status]);
  useEffect(() => {
    if (captureRequested && tab === "design" && !loading && !modelError) {
      const image = viewer.current?.snapshot();
      if (image) {
        setCapture(image);
        setCaptureRequested(false);
      }
    }
  }, [captureRequested, tab, loading, modelError]);
  const viewer = useRef(null),
    picker = useRef(null),
    host = useRef(null);
  const settings = { ...defaultSettings, ...state.settings };
  const title =
    job?.name
      .replace(/(?: · (?:优化方案|效果更新|结构复核))+$/, "")
      .replace(/\.(png|jpe?g|webp)$/i, "") ||
    imported?.name ||
    showcase.title;
  const url = job?.result?.model_url || imported?.url || showcase.model_url;
  const currentResult = job?.result;
  const reset = (top = false) => {
    setView(top ? "top" : "perspective");
    viewer.current?.reset(top);
  };
  const selectMaterial = (material, category) =>
    update((s) => ({
      ...s,
      category,
      selected: { ...s.selected, [category]: material.id },
    }));
  const action = async (verb, changes) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setActionError("");
    try {
      await projects[verb](id, changes);
      setImproving(false);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
      actionLock.current = false;
    }
  };
  const exportImage = () => {
    const image = viewer.current?.snapshot();
    if (image) setCapture(image);
  };
  useEffect(
    () => () => {
      if (imported?.url) URL.revokeObjectURL(imported.url);
    },
    [imported],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!active || tab === "edit") return;
    const handler = (e) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) &&
        !e.target.isContentEditable
      ) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [undo, redo, active, tab]);
  const heading = (
    <header className="task-heading">
      <div className="project-title">
        <h1 title={job?.name || title}>{title}</h1>
        <StatusBadge status={job?.status} />
      </div>
      {job?.status === "succeeded" && (
        <div className="project-actions">
          {tab !== "edit" && (
            <button
              type="button"
              className="primary-button layout-edit-button"
              title="手动调整墙体、门窗、家具和灯具"
              onClick={() => setTab("edit")}
            >
              <PencilRuler size={16} />
              <span>手动调整布局</span>
            </button>
          )}
          <button
            className="secondary-button export-button"
            onClick={() => setTab("assets")}
          >
            <Download size={15} /> <span>导出成果</span>
          </button>
        </div>
      )}
    </header>
  );
  return (
    <div
      className={`task-workspace ${tab === "edit" ? "is-editing" : ""} ${reviewing ? "is-reviewing" : ""}`}
      ref={host}
      hidden={!active}
    >
      {active && headingHost
        ? createPortal(heading, headingHost)
        : !headingHost && heading}
      {storageError && (
        <p className="connection-alert" role="status">
          {storageError}
        </p>
      )}
      {tab === "edit" && job && (
        <ManualEditor
          key={job.id}
          job={job}
          active={active}
          projects={projects}
          onClose={() =>
            setTab(reviewing ? "review" : hasModel ? "design" : "activity")
          }
        />
      )}
      {reviewing && tab !== "edit" && (
        <StructureReview
          job={job}
          projects={projects}
          onEdit={() => setTab("edit")}
        />
      )}
      <div
        className={`workspace-columns ${inspectorOpen ? "has-inspector" : "preview-only"}`}
        hidden={tab === "edit" || reviewing}
      >
        <div className="design-column">
          {currentResult?.delivery_notice && (
            <div className="delivery-notice" role="status">
              <TriangleAlert size={17} />
              <p>{currentResult.delivery_notice}</p>
              <button
                className="text-button"
                onClick={() => setImproving(true)}
              >
                完善家具 <ArrowRight size={13} />
              </button>
            </div>
          )}
          <nav className="workspace-tabs" aria-label="任务工作区内容">
            {[
              ["design", Box, "设计预览"],
              ["source", Image, "原始户型"],
              ["activity", ListChecks, "生成记录"],
              ["assets", FolderDown, "交付成果"],
            ]
              .filter(([key]) => job || key === "design")
              .map(([key, Icon, label]) => (
                <button
                  key={key}
                  className={tab === key ? "active" : ""}
                  aria-pressed={tab === key}
                  aria-label={label}
                  onClick={() => setTab(key)}
                >
                  <Icon size={15} />
                  {label}
                  {key === "assets" && job?.result && (
                    <span>
                      {3 +
                        Number(!!job.result.blend_url) +
                        Number(!!job.result.consistency_url) +
                        Number(!!job.result.quality_url)}
                    </span>
                  )}
                </button>
              ))}
            <div className="workspace-tools">
              {hasModel && (
                <button
                  aria-label="外观设置"
                  aria-expanded={inspectorOpen && panel === "design"}
                  aria-controls={`inspector-${id}`}
                  className={
                    inspectorOpen && panel === "design" ? "active" : ""
                  }
                  onClick={() => {
                    setInspectorOpen(!(inspectorOpen && panel === "design"));
                    setPanel("design");
                  }}
                >
                  <SlidersHorizontal size={15} />
                  <span className="tool-label">外观设置</span>
                </button>
              )}
              {job && (
                <button
                  aria-label="方案概览"
                  aria-expanded={inspectorOpen && panel === "overview"}
                  aria-controls={`inspector-${id}`}
                  className={
                    inspectorOpen && panel === "overview" ? "active" : ""
                  }
                  onClick={() => {
                    setPanel("overview");
                    setInspectorOpen(!(inspectorOpen && panel === "overview"));
                  }}
                >
                  <Box size={15} />
                  <span className="tool-label">方案概览</span>
                </button>
              )}
              {job && (
                <button
                  aria-label="任务详情"
                  aria-expanded={inspectorOpen && panel === "task"}
                  aria-controls={`inspector-${id}`}
                  className={inspectorOpen && panel === "task" ? "active" : ""}
                  onClick={() => {
                    setInspectorOpen(!(inspectorOpen && panel === "task"));
                    setPanel("task");
                  }}
                >
                  <Info size={15} />
                  <span className="tool-label">任务详情</span>
                </button>
              )}
            </div>
          </nav>
          <div
            className={`work-surface ${tab === "design" ? "canvas-surface" : ""}`}
          >
            <div className="design-panel" hidden={tab !== "design"}>
              {hasModel ? (
                <>
                  <Viewport
                    ref={viewer}
                    url={url}
                    active={
                      active && tab === "design" && !(mobile && inspectorOpen)
                    }
                    state={state}
                    settings={settings}
                    onLoading={setLoading}
                    onView={setView}
                    onError={setModelError}
                    onZoom={setZoom}
                    onThumbnails={setThumbs}
                  />
                  <div className="canvas-label">
                    <span className="live-dot" />
                    {view === "top" ? "平面俯视" : "三维空间"}
                    <small>
                      {job
                        ? "当前任务独立预览"
                        : imported
                          ? "本地导入预览"
                          : "示例模型"}
                    </small>
                  </div>
                  <div className="canvas-toolbar">
                    <div className="quick-lighting" aria-label="预览光照">
                      {presets.map((preset) => {
                        const Icon = lightIcons[preset.id];
                        return (
                          <button
                            key={preset.id}
                            aria-label={preset.name}
                            aria-pressed={state.preset === preset.id}
                            className={
                              state.preset === preset.id ? "active" : ""
                            }
                            onClick={() => update({ preset: preset.id })}
                          >
                            <Icon size={15} />
                            <span>{preset.name}</span>
                          </button>
                        );
                      })}
                    </div>
                    <span />
                    <IconButton
                      label="撤销"
                      icon={Undo2}
                      onClick={undo}
                      disabled={!canUndo}
                    />
                    <IconButton
                      label="重做"
                      icon={Redo2}
                      onClick={redo}
                      disabled={!canRedo}
                    />
                    <span />
                    <IconButton
                      label="导出当前效果图"
                      icon={Camera}
                      onClick={exportImage}
                      disabled={loading || !!modelError}
                    />
                    <IconButton
                      label="全屏工作区"
                      icon={Maximize}
                      onClick={() => {
                        const action = document.fullscreenElement
                          ? document.exitFullscreen()
                          : host.current.requestFullscreen();
                        action.catch(() => setNotice("当前浏览器不支持全屏"));
                      }}
                    />
                  </div>
                  <div
                    className="wall-display-options"
                    role="group"
                    aria-label="墙体显示方式"
                  >
                    <div className="wall-display-switch">
                      {[
                        [true, "剖切展示", "剖切展示", "查看室内布局与家具"],
                        [false, "完整墙体", "完整墙体", "查看完整墙高与门窗"],
                      ].map(([cutaway, label, accessibleLabel, title]) => (
                        <button
                          key={label}
                          type="button"
                          aria-label={accessibleLabel}
                          aria-pressed={settings.cutaway === cutaway}
                          title={title}
                          className={
                            settings.cutaway === cutaway ? "active" : ""
                          }
                          disabled={loading || !!modelError}
                          onClick={() => {
                            if (settings.cutaway !== cutaway)
                              update({ settings: { ...settings, cutaway } });
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="canvas-controls">
                    <div>
                      <button
                        className={view === "perspective" ? "active" : ""}
                        onClick={() => reset()}
                      >
                        <Box size={14} />
                        三维
                      </button>
                      <button
                        className={view === "top" ? "active" : ""}
                        onClick={() => reset(true)}
                      >
                        <Scan size={14} />
                        俯视
                      </button>
                    </div>
                    <IconButton
                      label="居中并适配户型"
                      icon={Focus}
                      onClick={() => reset(view === "top")}
                    />
                    <span />
                    <IconButton
                      label="缩小"
                      icon={Minus}
                      onClick={() => viewer.current?.zoom(1 / 1.12)}
                    />
                    <span className="zoom-value">{zoom}%</span>
                    <IconButton
                      label="放大"
                      icon={Plus}
                      onClick={() => viewer.current?.zoom(1.12)}
                    />
                  </div>
                  <div className="canvas-caption">
                    <span>拖动旋转 · 滚轮缩放</span>
                    <span>右键平移</span>
                  </div>
                  {loading && (
                    <div className="canvas-loading">
                      <LoaderCircle size={26} className="spin" />
                      <b>正在载入空间</b>
                      <span>加载本任务的模型与材质</span>
                    </div>
                  )}
                  {modelError && (
                    <div className="canvas-error" role="alert">
                      <h3>模型暂时无法显示</h3>
                      <p>{modelError}</p>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setModelError("");
                          setTab(job ? "source" : "design");
                          if (!job) setImported(null);
                        }}
                      >
                        {" "}
                        {job ? "查看原始户型" : "返回示例"}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <LoaderCircle
                    size={38}
                    className={!terminal(job.status) ? "spin" : ""}
                  />
                  <h2>
                    {job.status === "failed"
                      ? "本次生成未完成"
                      : job.status === "cancelled"
                        ? "任务已取消"
                        : "你的空间正在构建中"}
                  </h2>
                  <p>
                    {job.stage} · {job.progress}%
                  </p>
                  <button
                    className="secondary-button"
                    onClick={() => setTab("activity")}
                  >
                    查看生成记录 <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
            {tab === "source" && job && (
              <div className="source-page">
                <div className="section-heading">
                  <h2>原始户型图</h2>
                  <a
                    className="text-button"
                    href={job.source_url}
                    download={`${title}-原始户型.png`}
                  >
                    <Download size={14} />
                    保存原图
                  </a>
                </div>
                <div className="source-image">
                  <img src={job.source_url} alt={`${title}的原始户型图`} />
                </div>
                <p>仅展示当前任务的输入原图，作为结构识别与复核依据。</p>
              </div>
            )}
            {tab === "activity" && job && (
              <Activity job={job} events={projects.events} />
            )}
            {tab === "assets" && (
              <Deliverables
                job={job}
                onCapture={() => {
                  setCaptureRequested(true);
                  setTab("design");
                }}
              />
            )}
          </div>
          <div className="workspace-bottom">
            <span>
              <i />
              {job
                ? job.status === "succeeded"
                  ? "任务与成果已保存到本机"
                  : "任务与原图已保存到本机"
                : "示例空间 · 自由探索"}
            </span>
            <span>
              {job ? `独立工作区 · ${id.slice(0, 8)}` : "Three.js 实时渲染"}
            </span>
          </div>
        </div>
        <aside
          className="inspector"
          id={`inspector-${id}`}
          hidden={!inspectorOpen}
        >
          <div className="inspector-tabs">
            <button
              className={panel === "overview" ? "active" : ""}
              onClick={() => setPanel("overview")}
            >
              概览
            </button>
            <button
              className={panel === "design" ? "active" : ""}
              onClick={() => setPanel("design")}
            >
              <SlidersHorizontal size={14} />
              设计
            </button>
            <button
              className={panel === "task" ? "active" : ""}
              onClick={() => setPanel("task")}
            >
              <ListChecks size={14} />
              任务
            </button>
            <button
              className="inspector-close"
              aria-label="收起设置面板"
              onClick={() => setInspectorOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
          <div className="inspector-content">
            {panel === "overview" ? (
              <div className="overview-panel">
                <div className="overview-heading">
                  <span className="eyebrow">空间方案</span>
                  <h2>
                    {job || imported
                      ? "你的空间方案"
                      : "你的家，可以这样开始。"}
                  </h2>
                  <p>
                    {job || imported
                      ? "从原始户型，查看完整空间。"
                      : "先逛逛这个家，再创造你的。"}
                  </p>
                </div>
                {job?.source_url ? (
                  <button
                    className="source-preview"
                    aria-label="查看原始户型图"
                    onClick={() => {
                      setTab("source");
                      if (mobile) setInspectorOpen(false);
                    }}
                  >
                    <img src={job.source_url} alt="当前方案的原始户型图" />
                    <span>
                      原图对照 <ArrowUpRight size={14} />
                    </span>
                  </button>
                ) : (
                  <div className="sample-overview">
                    <span className="sample-eyebrow">THE FOREST HOME</span>
                    <h3>林间暖居</h3>
                    <p>阳光、木色，以及慢下来的生活。</p>
                    <div
                      className="sample-palette"
                      aria-label="奶油白、胡桃木、鼠尾草绿配色"
                    >
                      <i style={{ background: "#e9e1ce" }} />
                      <i style={{ background: "#79583e" }} />
                      <i style={{ background: "#87947a" }} />
                      <span>自然 · 温润 · 松弛</span>
                    </div>
                    <div className="sample-features">
                      <span>开放客餐厅</span>
                      <span>岛台厨房</span>
                      <span>独立书房</span>
                      <span>绿植露台</span>
                    </div>
                  </div>
                )}
                <div className="overview-stats">
                  <div>
                    <strong>
                      {currentResult?.area ??
                        (!job && !imported ? showcase.area : "—")}
                      <small>㎡</small>
                    </strong>
                    <span>户型面积</span>
                  </div>
                  <div>
                    <strong>
                      {currentResult?.room_count ??
                        (!job && !imported ? showcase.room_count : "—")}
                    </strong>
                    <span>空间数量</span>
                  </div>
                </div>
                {currentResult && (
                  <div className="overview-verification">
                    <h3>结构核对</h3>
                    <p>
                      <span
                        className={`review-dot ${currentResult.consistency?.source_reviewed ? "verified" : "pending"}`}
                      />
                      {currentResult.consistency?.source_reviewed
                        ? "原图结构已人工核对"
                        : "原图结构待人工核对"}
                    </p>
                    <p>
                      <span
                        className={`review-dot ${currentResult.consistency?.geometry_verified ? "verified" : "pending"}`}
                      />
                      {currentResult.consistency?.geometry_verified
                        ? "三维几何校验通过"
                        : "三维几何尚未校验"}
                    </p>
                    {!!currentResult.quality?.issues.length && (
                      <button
                        className="text-button"
                        onClick={() => setPanel("task")}
                      >
                        {currentResult.quality.issues.length} 处问题待查看{" "}
                        <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                )}
                <div className="overview-actions">
                  {!job && (
                    <button
                      className="primary-button full-width"
                      onClick={onCreate}
                    >
                      <Plus size={16} />
                      生成我的户型
                    </button>
                  )}
                  <button
                    className="secondary-button full-width"
                    onClick={() => setPanel("design")}
                  >
                    <SlidersHorizontal size={16} />
                    调整外观
                  </button>
                  {job?.status === "succeeded" && (
                    <button
                      className="text-button full-width"
                      disabled={busy}
                      onClick={() => setImproving(true)}
                    >
                      改进方案 <ArrowRight size={14} />
                    </button>
                  )}
                </div>
                <p className="overview-footnote">
                  {job ? "当前任务与成果保存在本机" : "示例空间可自由探索"}
                </p>
              </div>
            ) : panel === "design" ? (
              <>
                {hasModel && (
                  <div className="inspector-section inspector-materials">
                    <div className="section-heading">
                      <h2>材质与配色</h2>
                    </div>
                    <MaterialDock
                      state={state}
                      onSelect={selectMaterial}
                      onCategory={(category) => update({ category })}
                    />
                  </div>
                )}
                <div className="inspector-section">
                  <div className="section-heading">
                    <h2>空间概览</h2>
                    <Box size={14} />
                  </div>
                  <div className="space-stats">
                    <div>
                      <strong>
                        {currentResult?.area ??
                          (!job && !imported ? showcase.area : "—")}
                        <small>㎡</small>
                      </strong>
                      <span>建筑轮廓面积</span>
                    </div>
                    <div>
                      <strong>
                        {currentResult?.room_count ??
                          (!job && !imported ? showcase.room_count : "—")}
                      </strong>
                      <span>识别空间</span>
                    </div>
                  </div>
                </div>
                {!hasModel ? (
                  <div className="inspector-section muted">
                    生成完成后，可调整当前任务的材质、光照和显示效果。
                  </div>
                ) : (
                  <>
                    {currentResult?.quality && (
                      <div className="inspector-section">
                        <div className="section-heading">
                          <h2>设计检查</h2>
                          <Check size={14} />
                        </div>
                        <p className="verification-state">
                          {currentResult.consistency?.source_reviewed
                            ? "原图结构已人工核对"
                            : "原图结构尚未人工核对"}{" "}
                          ·{" "}
                          {currentResult.consistency?.geometry_verified
                            ? "模型截面校验通过"
                            : "模型尚未执行截面校验"}
                        </p>
                        <p className="field-note">
                          {currentResult.quality.furniture_count} 件家具 ·{" "}
                          {currentResult.quality.light_count} 盏灯
                        </p>
                        <p className="field-note">
                          {currentResult.quality.issues.length
                            ? `有 ${currentResult.quality.issues.length} 处结构或摆放问题，详见任务说明。`
                            : "未检测到明显的家具穿墙、重叠或堵门。"}
                        </p>
                      </div>
                    )}
                    <div className="inspector-section">
                      <div className="section-heading">
                        <h2>环境与照明</h2>
                        <span>
                          {presets.find((p) => p.id === state.preset)?.time}
                        </span>
                      </div>
                      <div className="light-presets">
                        {presets.map((preset) => {
                          const Icon = lightIcons[preset.id];
                          return (
                            <button
                              type="button"
                              key={preset.id}
                              aria-label={`切换到${preset.name}`}
                              aria-pressed={state.preset === preset.id}
                              onClick={() => update({ preset: preset.id })}
                              className={
                                state.preset === preset.id ? "active" : ""
                              }
                            >
                              {thumbs[preset.id] ? (
                                <img src={thumbs[preset.id]} alt="" />
                              ) : (
                                <div
                                  className={`light-placeholder ${preset.id}`}
                                />
                              )}
                              <span>
                                <Icon size={12} />
                                {preset.name}
                                <small>{preset.time}</small>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {state.preset === "night" && (
                        <p className="field-note">
                          {id === "sample"
                            ? "切换夜晚，查看空间的暖光照明效果。"
                            : "夜晚由方案中的灯具照明。点击顶部「手动调整布局」可调整灯位、亮度和色温。旧任务可更新三维效果以补充照明。"}
                        </p>
                      )}
                      <div className="slider-heading">
                        <label htmlFor="daylight">环境光强度</label>
                        <b>{state.daylight}%</b>
                      </div>
                      <input
                        id="daylight"
                        type="range"
                        min="0"
                        max="100"
                        value={state.daylight}
                        onChange={(e) =>
                          update({ daylight: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="inspector-section">
                      <div className="section-heading">
                        <h2>显示设置</h2>
                        <SlidersHorizontal size={14} />
                      </div>
                      {[
                        ["shadows", "模型阴影"],
                        ["rotate", "自动旋转"],
                        ["grid", "地面参考线"],
                      ].map(([key, label]) => (
                        <label className="toggle-row" key={key}>
                          {label}
                          <input
                            type="checkbox"
                            role="switch"
                            checked={settings[key]}
                            onChange={(e) =>
                              update({
                                settings: {
                                  ...settings,
                                  [key]: e.target.checked,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                      <button
                        className="text-button reset-appearance"
                        onClick={() => {
                          update(structuredClone(initialStudio));
                          reset();
                        }}
                      >
                        <RotateCcw size={12} />
                        重置本任务外观
                      </button>
                    </div>
                    {!job && (
                      <div className="inspector-section">
                        <button
                          className="secondary-button full-width"
                          onClick={() => picker.current.click()}
                        >
                          <Upload size={14} />
                          导入本地 GLB
                        </button>
                        <p className="field-note">
                          可预览已有模型，导入文件仅保留在当前页面。
                        </p>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                {job ? (
                  <>
                    <div className="inspector-section">
                      <div className="section-heading">
                        <h2>任务状态</h2>
                        <StatusBadge status={job.status} />
                      </div>
                      <div className="task-progress-heading">
                        <span>{job.stage}</span>
                        <b>{job.progress}%</b>
                      </div>
                      <div className="progress-track">
                        <i style={{ width: `${job.progress}%` }} />
                      </div>
                      <Pipeline job={job} />
                    </div>
                    <div className="inspector-section">
                      <div className="section-heading">
                        <h2>生成参数</h2>
                        <span>独立快照</span>
                      </div>
                      <dl className="task-parameters">
                        <dt>生成模型</dt>
                        <dd>
                          {job.result?.model || job.options.model || "本地默认"}
                        </dd>
                        <dt>推理强度</dt>
                        <dd>
                          {effortLabel(
                            job.result?.reasoning_effort ||
                              job.options.reasoning_effort,
                          )}
                        </dd>
                        <dt>空间风格</dt>
                        <dd>
                          {
                            {
                              natural: "自然原木",
                              cream: "奶油简约",
                              modern: "现代雅致",
                            }[job.options.style]
                          }
                        </dd>
                        <dt>AI 结构复核</dt>
                        <dd>
                          {job.options.collaboration ? "已启用" : "未启用"}
                        </dd>
                        <dt>家具方案</dt>
                        <dd>
                          {{ basic: "基础几何", library: "精细家具" }[
                            job.result?.furniture?.mode ||
                              job.options.furniture_mode
                          ] || "历史任务未记录"}
                        </dd>
                      </dl>
                      {job.options.notes && (
                        <div className="task-notes">
                          <b>设计要求</b>
                          <p>{job.options.notes}</p>
                        </div>
                      )}
                      {job.rebuild_of && (
                        <button
                          className="text-button"
                          onClick={async () => {
                            const parent = projects.jobs.find(
                              (j) => j.id === job.rebuild_of,
                            );
                            if (parent) projects.select(parent);
                            else
                              setActionError(
                                "来源任务暂未加载，请在任务栏中搜索其编号。",
                              );
                          }}
                        >
                          来源任务 #{job.rebuild_of.slice(0, 6)}{" "}
                          <ArrowUpRight size={12} />
                        </button>
                      )}
                    </div>
                    {job.result && (
                      <div className="inspector-section">
                        <h2>识别说明</h2>
                        <p className="field-note">{job.result.scale_note}</p>
                        {job.result.warnings?.length > 0 && (
                          <details>
                            <summary>
                              查看 {job.result.warnings.length} 条说明
                            </summary>
                            <ul>
                              {job.result.warnings.map((text, i) => (
                                <li key={i}>{text}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="inspector-section">
                    <h2>开始你的第一个设计</h2>
                    <p className="field-note">
                      示例用于体验效果。上传自己的户型图，即可建立独立的生成任务。
                    </p>
                    <button
                      className="primary-button full-width"
                      onClick={onCreate}
                    >
                      <Plus size={14} />
                      新建生成任务
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          {job && job.status !== "succeeded" && (
            <div className="inspector-footer">
              {job.can_recover_structure && (
                <>
                  <p className="field-note">
                    识别结果已保留，可以直接核对，无需重新识别。
                  </p>
                  <button
                    className="primary-button full-width"
                    disabled={busy}
                    onClick={() => action("retry", { reuse_structure: true })}
                  >
                    <PencilRuler size={14} />
                    继续核对已识别结构
                  </button>
                </>
              )}
              {actionError && (
                <p className="field-error" role="alert">
                  {actionError}
                </p>
              )}
              {!terminal(job.status) ? (
                <button
                  className="secondary-button full-width"
                  disabled={busy}
                  onClick={() => action("cancel")}
                >
                  <Square size={13} />
                  取消本次生成
                </button>
              ) : (
                <button
                  className={`${job.can_recover_structure ? "secondary-button" : "primary-button"} full-width`}
                  disabled={busy}
                  onClick={() => {
                    if (job.rebuild_of && !job.refine_of && !job.restructure_of)
                      action("retry");
                    else setRetrying(true);
                  }}
                >
                  <RotateCcw size={14} />
                  新建重试任务
                </button>
              )}
              <small>当前任务与其他生成相互独立</small>
            </div>
          )}
        </aside>
      </div>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {improving && (
        <Modal
          title="改进当前方案"
          onClose={() => !busy && setImproving(false)}
          className="improvement-dialog"
        >
          <fieldset disabled={busy} className="improvement-options">
            <legend>选择这次需要改进的内容</legend>
            {[
              [
                "restructure",
                "核对户型结构",
                "重新对照原图检查墙体、房间和门窗，确认后生成新版本。",
              ],
              [
                "refine",
                "重新布置家具",
                "保留墙体与门窗，重新规划家具和照明。",
              ],
              [
                "rebuild",
                "更新三维效果",
                "使用当前布局重新建模，更新材质和构件细节。",
              ],
            ].map(([value, label, description]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="improvement"
                  checked={improvement === value}
                  onChange={() => setImprovement(value)}
                />
                <span>
                  <b>{label}</b>
                  <small>{description}</small>
                </span>
              </label>
            ))}
          </fieldset>
          {actionError && (
            <p role="alert" className="field-error">
              {actionError}
            </p>
          )}
          <button
            className="primary-button full-width"
            disabled={busy}
            onClick={() => action(improvement)}
          >
            {busy ? "正在创建版本…" : "创建改进版本"}
          </button>
        </Modal>
      )}
      {retrying && job && (
        <RetryDialog
          job={job}
          projects={projects}
          onClose={() => setRetrying(false)}
        />
      )}
      {capture && (
        <Modal
          title={`${title} · 效果图`}
          className="capture-dialog"
          onClose={() => setCapture("")}
        >
          <img
            className="capture-image"
            src={capture}
            alt="当前任务的三维效果图"
          />
          <a
            className="primary-button"
            href={capture}
            download={`${title}-${id.slice(0, 8)}-效果图.png`}
          >
            <Download size={15} />
            保存效果图
          </a>
        </Modal>
      )}
      <input
        ref={picker}
        type="file"
        accept=".glb"
        aria-label="导入三维模型"
        hidden
        onChange={(e) => {
          const file = e.target.files[0];
          if (file) {
            setModelError("");
            setImported({ url: URL.createObjectURL(file), name: file.name });
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}
