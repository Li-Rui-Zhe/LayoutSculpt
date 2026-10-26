import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, X } from "lucide-react";
import { api } from "../api.js";
import DiyPreview from "../diy/DiyPreview.jsx";
import { useLibraryPreferences } from "../hooks/useLibraryPreferences.js";
import {
  replacementCandidates,
  replaceFurniture,
} from "../library/replacement.js";
import presets from "../../../assets/furniture/style-presets.json" with { type: "json" };
import "./furnitureReplacement.css";

function ReplacementDialog({ document, index, onCommit, onClose }) {
  const dialog = useRef(null);
  const current = document.furniture.items[index];
  const prefs = useLibraryPreferences();
  const [items, setItems] = useState([]),
    [selected, setSelected] = useState(null);
  const [style, setStyle] = useState("all"),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [preparing, setPreparing] = useState(false);
  const [template, setTemplate] = useState(null),
    [loadedUrl, setLoadedUrl] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    api("/library/assets", { signal: abort.signal })
      .then((v) => setItems(v.items))
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [revision]);
  useEffect(() => {
    setTemplate(null);
    setLoadedUrl(null);
    if (!selected) return;
    const abort = new AbortController();
    setPreparing(true);
    setError("");
    api("/library/placement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selected.id }),
      signal: abort.signal,
    })
      .then((value) => {
        if (!abort.signal.aborted) setTemplate(value);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setPreparing(false);
      });
    return () => abort.abort();
  }, [selected?.id, revision]);
  const candidates = replacementCandidates(
    items,
    current,
    prefs.value.archived,
  ).filter((i) => style === "all" || i.styles?.includes(style));
  let next = null,
    fitError = "";
  if (template) {
    try {
      next = replaceFurniture(document, index, template);
    } catch (e) {
      fitError = e.message;
    }
  }
  return (
    <dialog
      className="furniture-replacement"
      ref={dialog}
      onCancel={onClose}
      aria-label="更换家具款式"
    >
      <header>
        <div>
          <h2>更换款式</h2>
          <p>{current.name || "选中的家具"} · 保留位置、朝向与离地高度</p>
        </div>
        <button type="button" aria-label="关闭换款" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="replacement-body">
        <section className="replacement-options" aria-label="可替换款式">
          <label>
            风格
            <select
              aria-label="换款风格"
              value={style}
              onChange={(e) => {
                setStyle(e.target.value);
                setSelected(null);
              }}
            >
              <option value="all">全部风格</option>
              {Object.entries(presets.styles).map(([id, s]) => (
                <option key={id} value={id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {loading && <p role="status">正在读取可替换款式…</p>}
          {!loading && !candidates.length && (
            <p>没有匹配的款式，可切换风格或从素材库添加其他家具。</p>
          )}
          <div className="replacement-cards">
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={selected?.id === candidate.id}
                onClick={() => setSelected(candidate)}
              >
                {candidate.thumbnail_url && (
                  <img src={candidate.thumbnail_url} alt="" loading="lazy" />
                )}
                <strong>{candidate.name}</strong>
                <small>
                  {candidate.dimensions
                    ?.map((n) => Math.round(n * 100))
                    .join(" × ")}{" "}
                  cm
                </small>
                {current.source_asset_id === candidate.id && (
                  <small>当前款式</small>
                )}
              </button>
            ))}
          </div>
        </section>
        <section className="replacement-preview" aria-label="换款预览">
          {selected ? (
            <>
              <h3>{selected.name}</h3>
              <DiyPreview
                key={`${selected.id}:${revision}`}
                modelUrl={selected.model_url}
                frontDirection={selected.source === "builtin" ? 1 : -1}
                onModelReady={setLoadedUrl}
                onModelError={(value) => {
                  if (value) {
                    setError(value);
                    setLoadedUrl(null);
                  }
                }}
              />
              {preparing && <p role="status">正在检查尺寸与摆放位置…</p>}
              {template && (
                <p
                  className={
                    fitError ? "replacement-warning" : "replacement-valid"
                  }
                  role="status"
                >
                  {fitError || "原位置可用，确认后替换这一件家具。"}
                </p>
              )}
              <p>使用新款原始尺寸，不拉伸模型。其他家具保留，替换后可撤销。</p>
            </>
          ) : (
            <p>选择左侧款式，查看三维细节并检查能否放入原位置。</p>
          )}
          {error && (
            <p role="alert">
              {error}
              <button type="button" onClick={() => setRevision((v) => v + 1)}>
                重试
              </button>
            </p>
          )}
        </section>
      </div>
      <footer>
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={
            !next || preparing || !!error || loadedUrl !== selected?.model_url
          }
          onClick={() => {
            try {
              onCommit(replaceFurniture(document, index, template));
              onClose();
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          确认替换
        </button>
      </footer>
    </dialog>
  );
}

export default function FurnitureReplacement({ document, index, onCommit }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="diy-library-trigger"
        onClick={() => setOpen(true)}
      >
        <ArrowLeftRight size={14} />
        更换款式
      </button>
      {open && (
        <ReplacementDialog
          document={document}
          index={index}
          onCommit={onCommit}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
