import { useEffect, useRef, useState } from "react";
import {
  Boxes,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUpRight,
} from "lucide-react";
import { useProjects } from "./hooks/useProjects.js";
import TaskRail from "./components/TaskRail.jsx";
import TaskWorkspace from "./components/TaskWorkspace.jsx";
import GenerationForm from "./components/GenerationForm.jsx";
import { terminal } from "./api.js";

export default function App() {
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(0);
  const [railOpen, setRailOpen] = useState(false);
  const creationHost = useRef(null);
  useEffect(() => {
    if (creating) creationHost.current?.scrollTo({ top: 0 });
  }, [creating]);
  const activeCount = projects.jobs.filter(
    (job) => !terminal(job.status),
  ).length;
  const select = (job) => {
    projects.select(job);
    setCreating(false);
    setRailOpen(false);
  };
  return (
    <main className="factory">
      <header className="factory-header">
        <button
          className="mobile-menu icon-button"
          aria-label="切换任务栏"
          onClick={() => setRailOpen(!railOpen)}
        >
          {railOpen ? (
            <PanelLeftClose size={19} />
          ) : (
            <PanelLeftOpen size={19} />
          )}
        </button>
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
            栖境<span>户型设计工厂</span>
          </strong>
        </a>
        <span className="header-divider" />
        <div className="header-caption">从一张平面图，到一个理想的家</div>
        <div className="header-meta">
          <span className={`connection ${projects.health ? "online" : ""}`}>
            <i />
            {projects.health ? "本地引擎在线" : "连接中"}
          </span>
          <span className="local-tag">
            本地工作空间 <ArrowUpRight size={12} />
          </span>
        </div>
      </header>
      <div className="factory-body">
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
          onCreate={() => {
            setCreating(true);
            setRailOpen(false);
          }}
        />
        <section className="factory-workspace">
          {projects.error && (
            <div className="connection-alert" role="alert">
              {projects.error}
              <button onClick={projects.refresh}>重新连接</button>
            </div>
          )}
          <div className="workspace-breadcrumb">
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
              {activeCount ? `${activeCount} 个任务正在处理` : "让设计有序发生"}
            </span>
            <button className="text-button" onClick={() => setCreating(true)}>
              <Plus size={13} />
              新建任务
            </button>
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
