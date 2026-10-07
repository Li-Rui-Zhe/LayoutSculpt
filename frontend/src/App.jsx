import { useEffect, useRef, useState } from "react";
import { Boxes, Plus, PanelLeftClose, PanelLeftOpen, Home } from "lucide-react";
import { useProjects } from "./hooks/useProjects.js";
import TaskRail from "./components/TaskRail.jsx";
import TaskWorkspace from "./components/TaskWorkspace.jsx";
import GenerationForm from "./components/GenerationForm.jsx";

export default function App() {
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
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
    projects.select(job);
    setCreating(false);
    setRailOpen(false);
  };
  return (
    <main className="factory result-first">
      <header className="factory-header">
        <a
          className="factory-brand"
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
            造个家<span>户型设计工厂</span>
          </strong>
        </a>
        <div className="project-heading-host" ref={setHeadingHost} />
        <div className="header-meta">
          <span className={`connection ${projects.health ? "online" : ""}`}>
            <i />
            {projects.health ? "本地引擎在线" : "连接中"}
          </span>
          {!!(activeCount || reviewCount) && (
            <span className="local-tag">
              {[
                activeCount && `${activeCount} 个生成中`,
                reviewCount && `${reviewCount} 个待核对`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </div>
      </header>
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
            <span>任务</span>
          </button>
          <button
            aria-label="新建生成任务"
            title="新建户型"
            className={creating ? "active" : ""}
            onClick={() => {
              setCreating(true);
              setRailOpen(false);
            }}
          >
            <Plus size={20} />
            <span>新建</span>
          </button>
          <button
            aria-label="探索示例空间"
            title="示例空间"
            className={
              !creating && projects.selectedId === "sample" ? "active" : ""
            }
            onClick={() => select(null)}
          >
            <Home size={20} />
            <span>示例</span>
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
        <section className="factory-workspace">
          {projects.error && (
            <div className="connection-alert" role="alert">
              {projects.error}
              <button onClick={projects.refresh}>重新连接</button>
            </div>
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
              projects={projects}
              onCancel={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                setDraft((value) => value + 1);
              }}
            />
          </div>
          {projects.selectedId === "sample" || projects.job ? (
            <TaskWorkspace
              key={projects.job?.id || "sample"}
              active={!creating}
              job={projects.job}
              headingHost={headingHost}
              projects={projects}
              onCreate={() => setCreating(true)}
            />
          ) : (
            <div className="empty-state" hidden={creating}>
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
