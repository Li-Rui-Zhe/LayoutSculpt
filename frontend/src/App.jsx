import ApplySurfaceDialog from "./diy/ApplySurfaceDialog.jsx";
import ProjectTargetSelect from "./library/ProjectTargetSelect.jsx";
import ProgressBoundary from "./components/ProgressBoundary.jsx";
import { lazy, useEffect, useRef, useState } from "react";
import {
  Boxes,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Home,
  Sparkles,
  Armchair,
  Layers,
  Grid2X2,
  PlugZap,
  CircleHelp,
} from "lucide-react";
import { useProjects } from "./hooks/useProjects.js";
import TaskRail from "./components/TaskRail.jsx";
import TaskWorkspace from "./components/TaskWorkspace.jsx";
import GenerationForm from "./components/GenerationForm.jsx";
const AiConnections = lazy(() => import("./settings/AiConnections.jsx"));
const SurfaceStudio = lazy(() => import("./diy/SurfaceStudio.jsx"));
const DiyStudio = lazy(() => import("./diy/DiyStudio.jsx"));
import WorkspaceHelp from "./components/WorkspaceHelp.jsx";
import ConnectionNotice from "./components/ConnectionNotice.jsx";
import BuildNotice from "./components/BuildNotice.jsx";
import { useCustomTextures } from "./materials/customTextures.js";
import { placedDesign } from "./diy/design.js";
import AssetLibrary from "./library/AssetLibrary.jsx";
import { api } from "./api.js";
import {
  readContext,
  writeContext,
  useUrlContext,
} from "./hooks/urlContext.js";

export default function App() {
  useCustomTextures();
  const projects = useProjects();
  const [helpOpen, setHelpOpen] = useState(false);
  const [surface, setSurface] = useState(() =>
    ["diy", "library", "ai"].includes(location.hash.slice(1))
      ? location.hash.slice(1)
      : "workspace",
  );
  const [diyVisited, setDiyVisited] = useState(() => location.hash === "#diy");
  const [diyAssetId, setDiyAssetId] = useState(() =>
    readContext("diyAsset") ? { id: readContext("diyAsset") } : null,
  );
  const [diyMode, setDiyMode] = useUrlContext(
    "diyMode",
    () => {
      try {
        return sessionStorage.getItem("diy-mode") || "furniture";
      } catch {
        return "furniture";
      }
    },
    surface === "diy",
  );
  useEffect(() => {
    try {
      sessionStorage.setItem("diy-mode", diyMode);
    } catch {}
  }, [diyMode]);
  const surfaceDiy = surface === "diy" && diyMode !== "furniture";
  const [placementRequest, setPlacementRequest] = useState(null);
  const [boundaryRequest, setBoundaryRequest] = useState(null);
  const [architectureContext, setArchitectureContext] = useState(null);
  const [materialRequest, setMaterialRequest] = useState(null);
  const [surfaceToApply, setSurfaceToApply] = useState(null);
  const [materialContext, setMaterialContext] = useState({ id: "", rooms: [] });
  const navigate = (next) => {
    setSurface(next);
    setCreating(false);
    setRailOpen(false);
    if (next === "diy") setDiyVisited(true);
    location.hash = next;
  };
  useEffect(() => {
    const change = () => {
      const next = ["diy", "library", "ai"].includes(location.hash.slice(1))
        ? location.hash.slice(1)
        : "workspace";
      setSurface(next);
      if (next !== "workspace") setCreating(false);
      if (next === "diy") setDiyVisited(true);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const [creating, setCreating] = useState(false);
  const [replacementJob, setReplacementJob] = useState(null);
  const [draft, setDraft] = useState(0);
  const [railOpen, setRailOpen] = useState(false);
  const [headingHost, setHeadingHost] = useState(null);
  const creationHost = useRef(null);
  const taskMenu = useRef(null);
  useEffect(() => {
    if (!railOpen) return;
    const close = (event) => {
      if (event.key === "Escape") {
        setRailOpen(false);
        taskMenu.current?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [railOpen]);
  useEffect(() => {
    if (creating) creationHost.current?.scrollTo({ top: 0 });
  }, [creating]);
  const activeCount = projects.jobs.filter((job) =>
    ["queued", "running"].includes(job.status),
  ).length;
  const reviewCount = projects.jobs.filter(
    (job) => job.status === "awaiting_review",
  ).length;
  const select = (job) => {
    navigate("workspace");
    projects.select(job);
    setCreating(false);
    setRailOpen(false);
  };
  return (
    <main className="factory result-first studio-shell">
      <BuildNotice />
      <ConnectionNotice
        serviceError={projects.error}
        onRetry={projects.recheck}
      />
      <header className="factory-header">
        <a
          className="factory-brand"
          aria-label="造个家 LayoutSculpt · 返回示例空间"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            select(null);
          }}
        >
          <span className="brand-symbol">
            <Boxes size={24} />
          </span>
          <strong>
            造个家<span>LayoutSculpt</span>
          </strong>
        </a>
        <div className="project-heading-host" ref={setHeadingHost}>
          {creating && surface === "workspace" && <strong>新建户型</strong>}
          {surface !== "workspace" && (
            <strong>
              {surface === "diy"
                ? "DIY 设计 · 家具与墙地面"
                : surface === "ai"
                  ? "AI 接入 · 模型与连接"
                  : "素材库 · 模型与材质"}
            </strong>
          )}
        </div>
        <div className="header-meta">
          <button className="text-button" onClick={() => setHelpOpen(true)}>
            使用帮助
          </button>
          <span
            className={`connection ${projects.health ? "online" : ""}`}
            title="工作台负责保存任务和生成三维，使用 DeepSeek API 也需要工作台运行。"
          >
            <i />
            {projects.health
              ? projects.health.ai?.provider === "deepseek"
                ? projects.health.ai.deepseek_configured
                  ? "工作台在线 · DeepSeek 已配置"
                  : "工作台在线 · DeepSeek 待配置"
                : projects.health.codex?.connected
                  ? "工作台在线 · Codex 已连接"
                  : "工作台在线 · Codex 待连接"
              : projects.error
                ? "工作台未连接"
                : "正在连接工作台"}
          </span>
        </div>
      </header>
      {helpOpen && <WorkspaceHelp onClose={() => setHelpOpen(false)} />}
      {surfaceToApply && (
        <ApplySurfaceDialog
          {...surfaceToApply}
          jobs={projects.jobs}
          currentDraft={architectureContext}
          currentId={
            projects.job?.status === "succeeded" ? projects.job.id : ""
          }
          onClose={() => setSurfaceToApply(null)}
          onApply={(request) => {
            const job = projects.jobs.find(
              (j) => j.id === request.jobId && j.status === "succeeded",
            );
            if (!job) return;
            setMaterialRequest({ ...request, id: crypto.randomUUID() });
            setSurfaceToApply(null);
            select(job);
          }}
        />
      )}
      <div className="factory-body">
        <nav className="navigation-strip" aria-label="项目导航">
          <button
            className={railOpen ? "active" : ""}
            ref={taskMenu}
            aria-label="切换任务栏"
            title="我的任务"
            aria-expanded={railOpen}
            aria-controls="task-drawer"
            onClick={() => setRailOpen(!railOpen)}
          >
            {railOpen ? (
              <PanelLeftClose size={20} />
            ) : (
              <PanelLeftOpen size={20} />
            )}
            <span>我的方案</span>
            {!!(activeCount || reviewCount) && (
              <small
                className="nav-task-count"
                aria-label={`${activeCount} 个生成中，${reviewCount} 个待核对`}
              >
                {activeCount + reviewCount}
              </small>
            )}
          </button>
          <button
            aria-label="新建生成任务"
            title="新建户型"
            className={creating ? "active" : ""}
            aria-current={creating ? "page" : undefined}
            onClick={() => {
              navigate("workspace");
              setCreating(true);
              setRailOpen(false);
            }}
          >
            <Plus size={20} />
            <span>新建户型</span>
          </button>
          <button
            aria-label="探索示例空间"
            title="示例空间"
            aria-current={
              surface === "workspace" &&
              !creating &&
              projects.selectedId === "sample"
                ? "page"
                : undefined
            }
            className={
              surface === "workspace" &&
              !creating &&
              projects.selectedId === "sample"
                ? "active"
                : ""
            }
            onClick={() => select(null)}
          >
            <Home size={20} />
            <span>示例空间</span>
          </button>
          <button
            aria-label="打开 DIY 设计"
            title="DIY 设计 · 家具、墙面、地板"
            className={surface === "diy" ? "active" : ""}
            aria-current={surface === "diy" ? "page" : undefined}
            onClick={() => navigate("diy")}
          >
            <Sparkles size={20} />
            <span>DIY 创作</span>
          </button>
          <button
            aria-label="打开素材库"
            title="素材库 · 模型与材质"
            className={surface === "library" ? "active" : ""}
            aria-current={surface === "library" ? "page" : undefined}
            onClick={() => navigate("library")}
          >
            <Boxes size={20} />
            <span>素材库</span>
          </button>
          <button
            aria-label="打开 AI 接入"
            title="AI 接入 · Codex 与 DeepSeek"
            className={surface === "ai" ? "active" : ""}
            aria-current={surface === "ai" ? "page" : undefined}
            onClick={() => navigate("ai")}
          >
            <PlugZap size={20} />
            <span style={{ whiteSpace: "nowrap" }}>AI 接入</span>
          </button>
          <button
            className="mobile-help"
            aria-label="使用帮助"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={20} />
            <span>帮助</span>
          </button>
        </nav>
        {railOpen && (
          <button
            className="rail-backdrop"
            aria-label="收起任务栏"
            onClick={() => setRailOpen(false)}
          />
        )}
        <TaskRail
          projects={projects}
          creating={creating}
          open={railOpen}
          onSelect={select}
        />
        <section
          className={`factory-workspace ${surface === "diy" || surface === "library" || surface === "ai" ? "creation-workspace" : ""}`}
        >
          {surface === "ai" && (
            <ProgressBoundary label="正在打开 AI 接入…">
              <AiConnections />
            </ProgressBoundary>
          )}
          {surface === "diy" && (
            <div className="diy-hub-nav">
              <div className="creative-nav-title">
                <Sparkles size={19} />
                <strong>DIY 创作</strong>
              </div>
              <div role="tablist" aria-label="DIY 设计类型">
                {[
                  ["furniture", "家具 DIY", Armchair],
                  ["walls", "墙面 DIY", Layers],
                  ["floor", "地板 DIY", Grid2X2],
                ].map(([id, title, Icon]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={diyMode === id}
                    onClick={() => setDiyMode(id)}
                  >
                    <Icon size={15} />
                    {title}
                  </button>
                ))}
              </div>
              {!surfaceDiy && (
                <label>
                  目标户型
                  <ProjectTargetSelect
                    jobs={projects.jobs}
                    value={projects.job?.id || ""}
                    currentId={projects.job?.id || ""}
                    label="DIY 目标户型"
                    onChange={(id) => {
                      const job = projects.jobs.find((j) => j.id === id);
                      if (job) projects.select(job);
                    }}
                  />
                </label>
              )}
              <p>
                {surfaceDiy
                  ? "独立制作墙地面材质，保存到素材库后可用于任意户型。"
                  : "创建家具素材，再放入你的户型方案。"}
              </p>
            </div>
          )}
          {surfaceDiy && (
            <ProgressBoundary label="正在打开材质设计…">
              <SurfaceStudio
                key={diyMode}
                category={diyMode}
                onApply={(material) =>
                  setSurfaceToApply({ material, category: diyMode })
                }
                onLibrary={() => {
                  writeContext({
                    assetType: "materials",
                    materialCategory: diyMode,
                  });
                  navigate("library");
                }}
              />
            </ProgressBoundary>
          )}
          {diyVisited && (
            <div
              className="studio-page-host"
              hidden={surface !== "diy" || surfaceDiy}
            >
              <ProgressBoundary label="正在打开家具设计…">
                <DiyStudio
                  active={surface === "diy" && !surfaceDiy}
                  openAssetRequest={diyAssetId}
                  saveBeforeUse
                  useLabel="保存并选择放置位置"
                  onLibrary={(assetId) => {
                    try {
                      sessionStorage.setItem(
                        "library-context:page",
                        JSON.stringify({
                          assetType: "models",
                          source: "diy",
                          query: "",
                          selectedId: `diy:${assetId}`,
                          category: "all",
                          family: "all",
                          style: "all",
                        }),
                      );
                    } catch {
                      /* URL 仍指向 DIY 素材。 */
                    }
                    writeContext({
                      assetType: "models",
                      librarySource: "diy",
                      category: "all",
                      family: "all",
                      furnitureStyle: "all",
                      libraryAsset: `diy:${assetId}`,
                      q: null,
                    });
                    navigate("library");
                  }}
                  onUse={
                    projects.job?.status === "succeeded"
                      ? async (design) => {
                          const job = projects.job;
                          setPlacementRequest({
                            id: crypto.randomUUID(),
                            jobId: job.id,
                            template: placedDesign(
                              design,
                              { x: 0, y: 0 },
                              "pending",
                            ),
                          });
                          select(job);
                        }
                      : undefined
                  }
                  onClose={() => navigate("workspace")}
                />
              </ProgressBoundary>
            </div>
          )}
          {surface === "library" && (
            <AssetLibrary
              architectureJob={projects.job}
              onSelectArchitectureProject={(id) => {
                const job = projects.jobs.find((j) => j.id === id);
                if (job) projects.select(job);
              }}
              architectureDocument={
                architectureContext &&
                architectureContext.jobId === projects.job?.id
                  ? architectureContext.document
                  : null
              }
              selectedWallId={
                architectureContext &&
                architectureContext.jobId === projects.job?.id
                  ? architectureContext.wallId
                  : ""
              }
              onApplyBoundary={
                projects.job &&
                ["succeeded", "awaiting_review"].includes(projects.job.status)
                  ? (request) => {
                      setBoundaryRequest({
                        ...request,
                        id: crypto.randomUUID(),
                        jobId: projects.job.id,
                      });
                      navigate("workspace");
                    }
                  : null
              }
              materialRooms={
                materialContext.id === (projects.job?.id || "sample")
                  ? materialContext.rooms
                  : []
              }
              materialTargetName={projects.job?.name || "林间光庭 · 示例空间"}
              onApplyMaterial={
                !projects.job || projects.job.status === "succeeded"
                  ? (request) => {
                      setMaterialRequest({
                        ...request,
                        id: crypto.randomUUID(),
                        jobId: projects.job?.id || "sample",
                      });
                      navigate("workspace");
                    }
                  : null
              }
              jobs={projects.jobs}
              currentJobId={
                projects.job?.status === "succeeded" ? projects.job.id : ""
              }
              onPlace={(template, jobId) => {
                const job = projects.jobs.find(
                  (j) => j.id === jobId && j.status === "succeeded",
                );
                if (!job) throw Error("请先选择已完成的目标方案。");
                setPlacementRequest({
                  id: crypto.randomUUID(),
                  jobId,
                  template,
                });
                select(job);
              }}
              onEditDiy={(id) => {
                setDiyAssetId({ id });
                setDiyMode("furniture");
                navigate("diy");
              }}
              onOpenJob={async (id) => {
                const job =
                  projects.jobs.find((j) => j.id === id) ||
                  (await api(`/jobs/${id}`));
                select(job);
              }}
              onCreate={(mode) => {
                setDiyMode(
                  ["walls", "floor"].includes(mode) ? mode : "furniture",
                );
                navigate("diy");
              }}
            />
          )}
          <div className="workspace-breadcrumb" hidden={!creating}>
            <span>设计工厂</span>
            <span>/</span>
            <b>
              {creating
                ? "新建生成任务"
                : projects.job
                  ? "任务工作区"
                  : "示例工作区"}
            </b>
            <span className="workspace-count">
              {[
                activeCount && `${activeCount} 个任务正在处理`,
                reviewCount && `${reviewCount} 个待核对结构`,
              ]
                .filter(Boolean)
                .join(" · ") || "让设计有序发生"}
            </span>
          </div>
          <div ref={creationHost} hidden={!creating} className="creation-shell">
            <GenerationForm
              key={draft}
              replacementJob={replacementJob}
              projects={projects}
              onCancel={() => setCreating(false)}
              onCreated={() => {
                setReplacementJob(null);
                setCreating(false);
                setDraft((value) => value + 1);
              }}
            />
          </div>
          {projects.selectedId === "sample" || projects.job ? (
            <TaskWorkspace
              key={projects.job?.id || "sample"}
              active={!creating && surface === "workspace"}
              diyMode={null}
              onDiyModeChange={setDiyMode}
              onExitDiy={() => navigate("workspace")}
              job={projects.job}
              headingHost={headingHost}
              projects={projects}
              onConnections={() => navigate("ai")}
              placementRequest={
                placementRequest?.jobId === projects.job?.id
                  ? placementRequest
                  : null
              }
              onPlacementConsumed={() => setPlacementRequest(null)}
              boundaryRequest={
                boundaryRequest?.jobId === projects.job?.id
                  ? boundaryRequest
                  : null
              }
              onBoundaryConsumed={() => setBoundaryRequest(null)}
              onArchitectureContext={setArchitectureContext}
              materialRequest={
                materialRequest?.jobId === (projects.job?.id || "sample")
                  ? materialRequest
                  : null
              }
              onMaterialConsumed={() => setMaterialRequest(null)}
              onMaterialContext={setMaterialContext}
              onCreate={(source) => {
                if (source?.result?.failure?.code === "input_image_rejected") {
                  setReplacementJob(source);
                  setDraft((value) => value + 1);
                }
                setCreating(true);
              }}
            />
          ) : (
            <div
              className="empty-state"
              hidden={creating || surface !== "workspace"}
            >
              <Boxes size={38} />
              <h2>{projects.loading ? "正在恢复任务" : "任务暂不可用"}</h2>
              <p>可以从左侧选择任务，或新建一个设计。</p>
              <button
                className="primary-button"
                onClick={() => setCreating(true)}
              >
                新建任务
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
