import ApplySurfaceDialog from "./diy/ApplySurfaceDialog.jsx";
import ProjectTargetSelect from "./library/ProjectTargetSelect.jsx";
import ProgressBoundary from "./components/ProgressBoundary.jsx";
import { lazy, useEffect, useRef, useState } from "react";
import {
  Boxes,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Box,
  Sparkles,
  ImagePlus,
  Armchair,
  Layers,
  Grid2X2,
  PlugZap,
  Compass,
  CircleHelp,
} from "lucide-react";
import { useProjects } from "./hooks/useProjects.js";
import TaskRail from "./components/TaskRail.jsx";
import WorkspaceSidebar from "./components/WorkspaceSidebar.jsx";
import TaskWorkspace from "./components/TaskWorkspace.jsx";
import InteriorImageWorkspace from "./components/InteriorImageWorkspace.jsx";
import Modal from "./components/Modal.jsx";
import useInteriorDraft from "./hooks/useInteriorDraft.js";
import GenerationForm from "./components/GenerationForm.jsx";
const AiConnections = lazy(() => import("./settings/AiConnections.jsx"));
const RealRoam = lazy(() => import("./components/RealRoam.jsx"));
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

const surfaceTitles = {
  diy: "DIY 设计 · 家具与墙地面",
  effects: "效果图 · 三维取景",
  library: "素材库 · 模型与材质",
  ai: "AI 接入 · 模型与连接",
  roam: "真实漫游 · 实验",
};

const workspaceLinks = [
  ["workspace", Box, "自主 3D"],
  ["roam", Compass, "真实漫游"],
  ["diy", Sparkles, "DIY 创作"],
  ["effects", ImagePlus, "效果图"],
  ["library", Boxes, "素材库"],
  ["ai", PlugZap, "AI 接入"],
];

function surfaceFromHash() {
  const hash = location.hash.slice(1);
  return ["new-model", "new-roam"].includes(hash) ||
    Object.hasOwn(surfaceTitles, hash)
    ? hash
    : "workspace";
}

export default function App() {
  useCustomTextures();
  const projects = useProjects();
  const [helpOpen, setHelpOpen] = useState(false);
  const [surface, setSurface] = useState(surfaceFromHash);
  const interiorDraft = useInteriorDraft();
  const interiorView = interiorDraft.reference;
  const [interiorViewRequest, setInteriorViewRequest] = useState(null);
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
  const [furnitureDestination, setFurnitureDestination] = useState(null);
  const [boundaryRequest, setBoundaryRequest] = useState(null);
  const [architectureContext, setArchitectureContext] = useState(null);
  const [materialRequest, setMaterialRequest] = useState(null);
  const [surfaceToApply, setSurfaceToApply] = useState(null);
  const [materialContext, setMaterialContext] = useState({ id: "", rooms: [] });
  const navigate = (next, reviewId = null) => {
    writeContext({ roamReview: reviewId });
    setSurface(next);
    setRailOpen(false);
    if (next === "diy") setDiyVisited(true);
    location.hash = next;
  };
  useEffect(() => {
    const change = () => {
      const next = surfaceFromHash();
      setSurface(next);
      setRailOpen(false);
      if (next === "diy") setDiyVisited(true);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const creating = surface === "new-model" || surface === "new-roam";
  const creationMode = surface === "new-roam" ? "roam" : "model";
  useEffect(() => {
    const job = projects.job;
    if (
      surface === "workspace" &&
      job?.id === readContext("roamReview") &&
      ["queued", "running", "succeeded"].includes(job.status)
    )
      navigate("roam");
  }, [surface, projects.job?.id, projects.job?.status]);
  const [roamEditorRequest, setRoamEditorRequest] = useState(null);
  const [modelImport, setModelImport] = useState(null);
  const [replacementJob, setReplacementJob] = useState(null);
  const [draft, setDraft] = useState(0);
  const [railOpen, setRailOpen] = useState(false);
  const [headingHost, setHeadingHost] = useState(null);
  const creationHost = useRef(null);
  const taskMenu = useRef(null);

  const modelPicker = useRef(null);
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
  const select = (job, destination = "workspace") => {
    navigate(destination);
    projects.select(job);
    setRailOpen(false);
  };
  const sampleSelected = projects.selectedId === "sample";
  const sampleActive = surface === "workspace" && !creating && sampleSelected;
  const openSample = () => {
    if (sampleSelected) navigate("workspace");
    else select(null);
    taskMenu.current?.focus();
  };
  const chooseInteriorView = () => {
    const sourceId = interiorView?.projectId;
    const source = projects.jobs.find(
      (job) => job.id === sourceId && job.status === "succeeded",
    );
    const job =
      sourceId === "sample"
        ? null
        : source ||
          (projects.job?.status === "succeeded" ? projects.job : null);
    const projectId = job?.id || "sample";
    if (projects.selectedId === projectId) navigate("workspace");
    else select(job);
    setInteriorViewRequest({
      projectId,
      room: projectId === sourceId ? interiorView.room : null,
    });
  };
  const newFloorPlan = (mode = "model", replacement = null) => {
    setReplacementJob(replacement);
    navigate(mode === "roam" ? "new-roam" : "new-model");
  };
  return (
    <main className="factory result-first studio-shell">
      <BuildNotice />
      <ConnectionNotice
        serviceError={projects.error}
        onRetry={projects.recheck}
      />
      <input
        ref={modelPicker}
        type="file"
        accept=".glb"
        aria-label="导入三维模型"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            select(null);
            setModelImport(file);
          }
        }}
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
          {surface !== "roam" && surfaceTitles[surface] && (
            <strong>{surfaceTitles[surface]}</strong>
          )}
        </div>
        <div className="header-meta">
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
      {furnitureDestination && (
        <Modal
          title="把家具放进哪个家？"
          onClose={() => setFurnitureDestination(null)}
        >
          <p>家具已保存到素材库。选择一个方案，再到画布上决定摆放位置。</p>
          <ProjectTargetSelect
            jobs={projects.jobs}
            value={furnitureDestination.targetId}
            label="家具放入目标户型"
            currentId={projects.job?.id || ""}
            onChange={(targetId) =>
              setFurnitureDestination((v) => ({ ...v, targetId }))
            }
          />
          <div className="dialog-actions">
            <button
              className="secondary-button"
              onClick={() => setFurnitureDestination(null)}
            >
              暂不放入
            </button>
            <button
              className="primary-button"
              disabled={
                !projects.jobs.some(
                  (j) =>
                    j.id === furnitureDestination.targetId &&
                    j.status === "succeeded",
                )
              }
              onClick={() => {
                const job = projects.jobs.find(
                  (j) =>
                    j.id === furnitureDestination.targetId &&
                    j.status === "succeeded",
                );
                if (!job) return;
                setPlacementRequest({
                  id: crypto.randomUUID(),
                  jobId: job.id,
                  template: placedDesign(
                    furnitureDestination.design,
                    { x: 0, y: 0 },
                    "pending",
                  ),
                });
                setFurnitureDestination(null);
                select(job);
              }}
            >
              去选择摆放位置
            </button>
          </div>
        </Modal>
      )}
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
            aria-label="我的方案"
            title="我的方案"
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
          </button>
          <button
            aria-label="新建方案"
            title="新建方案"
            className={creating ? "active" : ""}
            aria-current={creating ? "page" : undefined}
            onClick={() =>
              newFloorPlan(
                surface === "roam" || creationMode === "roam"
                  ? "roam"
                  : "model",
              )
            }
          >
            <Plus size={20} />
            <span>新建方案</span>
          </button>
          <span className="nav-divider" aria-hidden="true" />
          {workspaceLinks.map(([id, Icon, label]) => (
            <button
              key={id}
              aria-label={`打开${label}`}
              title={label}
              className={surface === id ? "active" : ""}
              aria-current={surface === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
          <button aria-label="使用帮助" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={20} aria-hidden="true" />
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
          onSelect={(job) =>
            select(
              job,
              surface === "roam" || surface === "new-roam"
                ? "roam"
                : "workspace",
            )
          }
          sampleActive={sampleActive}
          onOpenSample={openSample}
        />
        <section
          className={`factory-workspace ${surface !== "workspace" ? "creation-workspace" : ""}`}
        >
          <InteriorImageWorkspace
            active={surface === "effects"}
            reference={interiorView}
            draft={interiorDraft}
            offline={!projects.health && !!projects.error}
            onChooseView={chooseInteriorView}
            onConnections={() => navigate("ai")}
          />
          {surface === "ai" && (
            <ProgressBoundary label="正在打开 AI 接入…">
              <AiConnections />
            </ProgressBoundary>
          )}
          {surface === "roam" && (
            <ProgressBoundary label="正在打开真实漫游…">
              <RealRoam
                key={projects.selectedId}
                projectId={projects.selectedId}
                job={projects.job}
                jobs={projects.jobs}
                projects={projects}
                onProject={() => navigate("workspace")}
                onEditStructure={() => {
                  setRoamEditorRequest({ id: projects.selectedId });
                  navigate("workspace", projects.selectedId);
                }}
                onHistoryTask={async (id, version) => {
                  const job =
                    id === "sample"
                      ? null
                      : projects.jobs.find((item) => item.id === id) ||
                        (await api(`/jobs/${id}`));
                  select(job, "roam");
                  if (version)
                    writeContext({
                      roamRoom: version.context.roomId,
                      roamVersion: version.id,
                    });
                }}
              />
            </ProgressBoundary>
          )}
          {diyVisited && (
            <div className="diy-workspace-layout" hidden={surface !== "diy"}>
              <WorkspaceSidebar
                label="DIY 创作侧栏"
                className="diy-mode-sidebar"
                compactToggle="DIY 类型"
              >
                <nav aria-label="DIY 设计类型">
                  {[
                    ["furniture", "家具 DIY", Armchair],
                    ["walls", "墙面 DIY", Layers],
                    ["floor", "地板 DIY", Grid2X2],
                  ].map(([id, title, Icon]) => (
                    <button
                      type="button"
                      key={id}
                      aria-current={diyMode === id ? "true" : undefined}
                      onClick={() => setDiyMode(id)}
                    >
                      <Icon size={16} aria-hidden="true" />
                      {title}
                    </button>
                  ))}
                </nav>
              </WorkspaceSidebar>
              <div className="diy-workspace-body">
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
                <div
                  className="studio-page-host"
                  hidden={surface !== "diy" || surfaceDiy}
                >
                  <ProgressBoundary label="正在打开家具设计…">
                    <DiyStudio
                      active={surface === "diy" && !surfaceDiy}
                      openAssetRequest={diyAssetId}
                      saveBeforeUse
                      closeAfterUse={false}
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
                      onUse={async (design) =>
                        setFurnitureDestination({
                          design,
                          targetId:
                            projects.job?.status === "succeeded"
                              ? projects.job.id
                              : "",
                        })
                      }
                      onClose={() => navigate("workspace")}
                    />
                  </ProgressBoundary>
                </div>
              </div>
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
          {creating && (
            <div ref={creationHost} className="creation-shell">
              <GenerationForm
                key={`${draft}:${creationMode}`}
                replacementJob={replacementJob}
                mode={creationMode}
                onModeChange={(mode) => {
                  if (mode === creationMode) return;
                  setReplacementJob(null);
                  navigate(mode === "roam" ? "new-roam" : "new-model");
                }}
                onImportModel={() => modelPicker.current.click()}
                projects={projects}
                onCancel={() =>
                  creationMode === "roam"
                    ? navigate("roam")
                    : navigate("workspace")
                }
                onCreated={() => {
                  setReplacementJob(null);
                  navigate(creationMode === "roam" ? "roam" : "workspace");
                  setDraft((value) => value + 1);
                }}
              />
            </div>
          )}
          {projects.selectedId === "sample" || projects.job ? (
            <TaskWorkspace
              key={projects.job?.id || "sample"}
              active={!creating && surface === "workspace"}
              reviewEditorRequest={
                roamEditorRequest?.id === projects.job?.id
                  ? roamEditorRequest
                  : null
              }
              onReturnToRoamReview={
                projects.job?.id &&
                readContext("roamReview") === projects.job.id
                  ? () => navigate("roam")
                  : null
              }
              diyMode={null}
              onDiyModeChange={setDiyMode}
              onExitDiy={() => navigate("workspace")}
              job={projects.job}
              headingHost={headingHost}
              projects={projects}
              modelImport={
                projects.selectedId === "sample" ? modelImport : null
              }
              onImportModel={() => modelPicker.current.click()}
              onModelImported={() => setModelImport(null)}
              onConnections={() => navigate("ai")}
              onInteriorView={(view) => {
                interiorDraft.choose(view);
                navigate("effects");
              }}
              interiorViewRequest={
                interiorViewRequest?.projectId ===
                (projects.job?.id || "sample")
                  ? interiorViewRequest
                  : null
              }
              onInteriorViewRequestConsumed={() => setInteriorViewRequest(null)}
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
                newFloorPlan(
                  "model",
                  source?.result?.failure?.code === "input_image_rejected"
                    ? source
                    : null,
                );
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
              <button className="primary-button" onClick={() => newFloorPlan()}>
                新建任务
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
