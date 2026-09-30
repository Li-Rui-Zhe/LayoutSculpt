import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import Viewport from "./Viewport.jsx";
import Modal from "./Modal.jsx";
import { MaterialDock } from "./Materials.jsx";
import { useStudio, initialStudio } from "../hooks/useStudio.js";
import { effortLabel } from "../hooks/useModels.js";
import { presets } from "../catalog.js";
import { terminal } from "../api.js";
import { StatusBadge } from "./TaskRail.jsx";
import ManualEditor from "../editor/ManualEditor.jsx";

const lightIcons = {
  midday: Sun,
  night: Moon,
};
const defaultSettings = { shadows: true, rotate: false, grid: false };
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
  if (job?.edited_of)
    return [
      ["读取人工设计", 5],
      ["生成三维版本", 82],
      ["成果交付", 100],
    ];
  return job?.rebuild_of
    ? [
        ["复用户型布局", 5],
        ["精细家具建模", 82],
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
        const done =
          job?.status === "succeeded" ||
          job?.progress >= (steps[index + 1]?.[1] ?? 100);
        const active = !done && job?.progress >= threshold;
        return (
          <li key={name} className={done ? "done" : active ? "current" : ""}>
            <span>
              {done ? <Check size={13} /> : String(index + 1).padStart(2, "0")}
            </span>
            <b>{name}</b>
            {active && !terminal(job.status) && (
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
                <p>{event.message}</p>
              </div>
            </div>
          ))
        ) : (
          <div className="muted">正在同步本任务的生成记录…</div>
        )}
      </div>
      {job.error && (
        <div className="form-error" role="alert">
          {job.error}
        </div>
      )}
    </section>
  );
}
function Deliverables({ job, onCapture }) {
  if (!job?.result)
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
          [
            Box,
            "Blender 工程",
            "BLEND",
            "包含模型、家具与打包贴图",
            result.blend_url,
          ],
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
}) {
  const id = job?.id || "sample";
  const { state, update, undo, redo, canUndo, canRedo } = useStudio(id);
  const hasModel = !job || job.status === "succeeded";
  const [tab, setTab] = useState(hasModel ? "design" : "activity");
  const [panel, setPanel] = useState(hasModel ? "design" : "task");
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
  const viewer = useRef(null),
    picker = useRef(null),
    host = useRef(null);
  const settings = state.settings || defaultSettings;
  const title =
    job?.name.replace(/\.(png|jpe?g|webp)$/i, "") ||
    imported?.name ||
    "自然主义 · 示例空间";
  const url =
    job?.result?.model_url || imported?.url || "/models/apartment.glb";
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
  const action = async (verb) => {
    setBusy(true);
    setActionError("");
    try {
      await projects[verb](id);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
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
  return (
    <div
      className={`task-workspace ${tab === "edit" ? "is-editing" : ""}`}
      ref={host}
      hidden={!active}
    >
      <header className="task-heading">
        <div>
          <div className="task-heading-meta">
            <span>
              {job ? `任务 #${id.slice(0, 8).toUpperCase()}` : "示例工作区"}
            </span>
            <StatusBadge status={job?.status} />
            {job?.edited_of ? (
              <span>人工设计版本</span>
            ) : (
              job?.rebuild_of && <span>家具更新</span>
            )}
          </div>
          <h1>{title}</h1>
          <p>
            {job
              ? `${new Date(job.created_at).toLocaleString("zh-CN")} 创建 · ${currentResult?.title || job.stage}`
              : "试试不同的光照与材质，探索空间的更多可能。"}
          </p>
        </div>
        <div className="heading-actions">
          {job?.status === "succeeded" && (
            <button
              className={`secondary-button ${tab === "edit" ? "edit-active" : ""}`}
              onClick={() => setTab("edit")}
            >
              <PencilRuler size={15} />
              人工设计
            </button>
          )}
          {hasModel && (
            <button
              className="secondary-button"
              onClick={() => {
                setTab("design");
                if (tab === "design") exportImage();
                else setNotice("已打开设计预览，点击相机即可导出当前效果。");
              }}
            >
              <Camera size={15} />
              导出效果图
            </button>
          )}
          {job?.status === "succeeded" ? (
            <button className="primary-button" onClick={() => setTab("assets")}>
              <FolderDown size={15} />
              交付成果
            </button>
          ) : !job ? (
            <button className="primary-button" onClick={onCreate}>
              <Plus size={15} />
              生成我的户型
            </button>
          ) : null}
        </div>
      </header>
      {tab === "edit" && job && (
        <ManualEditor
          key={job.id}
          job={job}
          active={active}
          projects={projects}
          onClose={() => setTab("design")}
        />
      )}
      <div className="workspace-columns" hidden={tab === "edit"}>
        <div className="design-column">
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
                  onClick={() => setTab(key)}
                >
                  <Icon size={15} />
                  {label}
                  {key === "assets" && job?.result && <span>4</span>}
                </button>
              ))}
            <span className="workspace-tabs-end">
              {hasModel ? "设计工作区" : "生成工作区"}
            </span>
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
                    active={active && tab === "design"}
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
                      onClick={() => reset()}
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
                    <span>拖动旋转 · 滚轮缩放 · 右键平移</span>
                    <span>实时三维预览</span>
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
              <Deliverables job={job} onCapture={() => setTab("design")} />
            )}
          </div>
          {tab === "design" && hasModel && (
            <MaterialDock
              state={state}
              onSelect={selectMaterial}
              onCategory={(category) => update({ category })}
            />
          )}
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
        <aside className="inspector">
          <div className="inspector-tabs">
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
          </div>
          <div className="inspector-content">
            {panel === "design" ? (
              <>
                <div className="inspector-section">
                  <div className="section-heading">
                    <h2>空间概览</h2>
                    <Box size={14} />
                  </div>
                  <div className="space-stats">
                    <div>
                      <strong>
                        {currentResult?.area ?? (!job && !imported ? 86 : "—")}
                        <small>㎡</small>
                      </strong>
                      <span>建筑轮廓面积</span>
                    </div>
                    <div>
                      <strong>{currentResult?.room_count ?? "—"}</strong>
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
                    <div className="inspector-section">
                      <div className="section-heading">
                        <h2>白天 / 夜晚</h2>
                        <span>
                          {presets.find((p) => p.id === state.preset)?.time}
                        </span>
                      </div>
                      <div className="light-presets">
                        {presets.map((preset) => {
                          const Icon = lightIcons[preset.id];
                          return (
                            <button
                              key={preset.id}
                              className={
                                state.preset === preset.id ? "active" : ""
                              }
                              aria-pressed={state.preset === preset.id}
                              onClick={() => update({ preset: preset.id })}
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
                          夜晚由人工设计中摆放的灯具照明。新增或修改灯具后保存三维版本即可查看。
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
                        <dt>空间复核</dt>
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
          {job && (
            <div className="inspector-footer">
              {actionError && (
                <p className="field-error" role="alert">
                  {actionError}
                </p>
              )}
              {job.status === "succeeded" ? (
                <button
                  className="secondary-button full-width"
                  disabled={busy}
                  onClick={() => action("rebuild")}
                >
                  <RotateCcw size={14} />
                  {busy ? "正在创建任务…" : "新建精细家具任务"}
                </button>
              ) : !terminal(job.status) ? (
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
                  className="primary-button full-width"
                  disabled={busy}
                  onClick={() => action("retry")}
                >
                  <RotateCcw size={14} />
                  新建重试任务
                </button>
              )}
              <small>
                {job.status === "succeeded"
                  ? "复用布局生成新任务，保留当前成果"
                  : "当前任务与其他生成相互独立"}
              </small>
            </div>
          )}
        </aside>
      </div>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
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
