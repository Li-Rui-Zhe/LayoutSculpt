import { useState } from "react";
import DiyPreview from "../diy/DiyPreview.jsx";
import catalog from "./lightingCatalog.json";
import "./architecture.css";
import "./lighting.css";

export default function LightingLibrary({
  job,
  jobs = [],
  onSelectProject,
  onApply,
}) {
  const [kind, setKind] = useState(catalog[0].kind);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [readyUrl, setReadyUrl] = useState(null);
  const selected = catalog.find((item) => item.kind === kind);
  const eligible = job && ["succeeded", "awaiting_review"].includes(job.status);
  const apply = async (view) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onApply({ lightPreset: kind, view });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="lighting-library">
      <div className="library-browser">
        <input
          className="lighting-search"
          type="search"
          aria-label="搜索灯具"
          placeholder="搜索落地灯、台灯、吊灯…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="architecture-cards" aria-label="灯具素材列表">
          {catalog
            .filter((item) =>
              `${item.name} ${item.description}`.includes(query.trim()),
            )
            .map((item) => (
              <button
                key={item.kind}
                className="architecture-card"
                aria-pressed={kind === item.kind}
                onClick={() => {
                  setKind(item.kind);
                  setError("");
                }}
              >
                <img
                  className="architecture-thumbnail"
                  src={item.thumbnail_url}
                  alt={`${item.name}模型`}
                />
                <strong>{item.name}</strong>
                <small>{item.lumens} lm · 3000 K</small>
              </button>
            ))}
        </div>
        {!catalog.some((item) =>
          `${item.name} ${item.description}`.includes(query.trim()),
        ) && <p>没有匹配的灯具，请换个关键词。</p>}
        <p className="library-note">
          这六款灯具与人工设计、保存生成共用模型，可调整位置、高度、亮度、色温和开关。
        </p>
      </div>
      <aside className="lighting-inspector">
        <h2>{selected.name}</h2>
        <div
          className="lighting-model"
          data-ready={readyUrl === selected.model_url}
        >
          <DiyPreview
            key={kind}
            modelUrl={selected.model_url}
            onModelReady={setReadyUrl}
          />
        </div>
        <p>{selected.description}</p>
        <p className="library-note">
          {["bulb", "pendant"].includes(kind)
            ? "为避免遮挡空间，设计预览默认隐藏灯泡和吊灯外形，照明仍生效，可从对象列表选中调整。素材库始终显示完整模型。"
            : "设计时显示真实灯具。生成后切换夜晚，可查看照明效果。"}
        </p>
        {!!onSelectProject && (
          <label>
            放入方案
            <select
              aria-label="灯具目标方案"
              value={job?.id || ""}
              onChange={(e) => onSelectProject(e.target.value)}
            >
              <option value="">选择可编辑的方案</option>
              {jobs
                .filter((j) =>
                  ["succeeded", "awaiting_review"].includes(j.status),
                )
                .map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <div className="architecture-entry-actions">
          {[
            ["plan", "在平面中放置"],
            ["scene", "在三维中放置"],
          ].map(([view, name]) => (
            <button
              key={view}
              className="primary-button"
              disabled={!eligible || !onApply || busy}
              onClick={() => apply(view)}
            >
              {name}
            </button>
          ))}
        </div>
        {!eligible && (
          <p className="library-note">
            选择已识别或已完成的方案后即可添加，示例仅供浏览。
          </p>
        )}
        <p className="library-note">
          进入设计页后点击落点放置，添加后可拖动及精调；最多 12 盏灯。
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </aside>
    </div>
  );
}
