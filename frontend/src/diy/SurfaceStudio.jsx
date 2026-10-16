import { useEffect, useRef, useState } from "react";
import { materials, materialCategories } from "../catalog.js";
import { api } from "../api.js";
import {
  loadCustomTextures,
  useCustomTextures,
} from "../materials/customTextures.js";
import MaterialSample from "../components/MaterialSample.jsx";
import SurfacePainter from "./SurfacePainter.jsx";
import SurfaceAiCreator from "./SurfaceAiCreator.jsx";
import SurfacePreview from "./SurfacePreview.jsx";
import { readArtwork } from "./paintTools.js";
import {
  SURFACE_MODES,
  MODE_LABELS,
  restoreSurfaces,
  sourceRecipe,
  surfaceSaveReason,
} from "./surfaceWorkspace.js";
import "./surfaceStudio.css";

const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};
const dataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error("底图读取失败"));
    reader.readAsDataURL(blob);
  });

export default function SurfaceStudio({ category, onLibrary }) {
  useCustomTextures();
  const label = category === "walls" ? "墙面" : "地板";
  const bases = materials.filter(
    (m) =>
      materialCategories[category].includes(m.id) &&
      !m.id.startsWith("texture:"),
  );
  const [initial] = useState(() =>
    restoreSurfaces(
      category,
      bases,
      readJson(`surface-workspace:v2:${category}`),
      readJson(`surface-draft:${category}`),
    ),
  );
  const [mode, setMode] = useState(initial.mode),
    [drafts, setDrafts] = useState(initial.drafts);
  const draft = drafts[mode];
  const [paintVisited, setPaintVisited] = useState(initial.mode === "draw"),
    [paintSeed, setPaintSeed] = useState(null);
  const [paintImage, setPaintImage] = useState(""),
    [paintStatus, setPaintStatus] = useState("loading"),
    [paintError, setPaintError] = useState("");
  const [paintRetry, setPaintRetry] = useState(0),
    [paintSession, setPaintSession] = useState(0),
    [aiSelection, setAiSelection] = useState(null);
  const [preview, setPreview] = useState(""),
    [previewBusy, setPreviewBusy] = useState(false),
    [previewError, setPreviewError] = useState("");
  const [previewRetry, setPreviewRetry] = useState(0),
    [tileView, setTileView] = useState(false);
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState("");
  const [saved, setSaved] = useState(null),
    [pendingSeed, setPendingSeed] = useState(null);
  const importPicker = useRef(null),
    appliedAiJob = useRef(readJson(`surface-ai-applied:${category}`)),
    saveLock = useRef(false),
    latestPaint = useRef(""),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const own = materials.filter((m) => m.recipe?.category === category);
  const hasSource =
    !!draft.base_id &&
    (mode !== "ai" || aiSelection?.result?.id === draft.base_id);
  const saveReason = surfaceSaveReason({
    hasSource,
    mode,
    paintStatus,
    previewBusy,
    previewError,
    name: draft.name,
    busy: busy || uploading,
  });
  const selectMode = (next) => {
    setMode(next);
    setError("");
    if (next === "draw") setPaintVisited(true);
  };
  const change = (patch) =>
    setDrafts((all) => ({ ...all, [mode]: { ...all[mode], ...patch } }));
  const receivePaint = (image) => {
    if (latestPaint.current === image) return;
    latestPaint.current = image;
    setPaintImage(image);
    setPaintStatus("pending");
    setPaintError("");
  };
  useEffect(() => {
    try {
      localStorage.setItem(
        `surface-workspace:v2:${category}`,
        JSON.stringify({ mode, drafts }),
      );
    } catch {}
  }, [category, mode, drafts]);

  // 手绘独立同步；其他页签始终可继续使用。取消旧请求，防止慢响应覆盖新笔画。
  useEffect(() => {
    if (!paintImage) return;
    let live = true;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPaintStatus("syncing");
      try {
        const blob = await (await fetch(paintImage)).blob();
        const form = new FormData();
        form.append("file", blob, "手绘材质.png");
        form.append("category", category);
        form.append("origin", "draw");
        const source = await api("/materials/source", {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
        if (!live) return;
        setDrafts((all) => ({
          ...all,
          draw: sourceRecipe(all.draw, source, false),
        }));
        setPaintStatus("ready");
        setPaintError("");
      } catch (e) {
        if (live) {
          setPaintStatus("failed");
          setPaintError(e.message);
        }
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [paintImage, paintRetry, category]);

  useEffect(() => {
    if (!hasSource) {
      setPreview("");
      setPreviewError("");
      setPreviewBusy(false);
      return;
    }
    const controller = new AbortController();
    let url;
    setPreviewBusy(true);
    setPreviewError("");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/materials/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...draft,
            name: draft.name.trim() || `我的${label}材质`,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw Error(
            typeof body.detail === "string"
              ? body.detail
              : "材质预览失败，请重试",
          );
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
        setPreviewBusy(false);
      } catch (e) {
        if (!controller.signal.aborted) {
          setPreviewError(e.message);
          setPreviewBusy(false);
        }
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [draft, hasSource, label, previewRetry]);

  const onAiSelection = (job) => {
    setAiSelection(job);
    if (!job?.result) return;
    if (appliedAiJob.current === job.id) return;
    const previousJob = appliedAiJob.current;
    appliedAiJob.current = job.id;
    try {
      localStorage.setItem(
        `surface-ai-applied:${category}`,
        JSON.stringify(job.id),
      );
    } catch {}
    setDrafts((all) =>
      !previousJob && all.ai.base_id === job.result.id
        ? all
        : {
            ...all,
            ai: {
              ...sourceRecipe(all.ai, job.result),
              roughness: job.result.roughness ?? 0.8,
              name:
                job.result.parameters?.name ||
                `${job.prompt.slice(0, 34)} · ${label}`,
            },
          },
    );
  };
  const save = async (event) => {
    event.preventDefault();
    if (saveLock.current || saveReason) return;
    const snapshot = { ...draft },
      currentMode = mode;
    saveLock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api("/materials/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      await loadCustomTextures(true);
      if (mounted.current)
        setSaved({
          ...result,
          mode: currentMode,
          signature: JSON.stringify(snapshot),
        });
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setBusy(false);
      saveLock.current = false;
    }
  };
  const openSaved = (material) => {
    // 保存后的 PNG 包含全部像素，恢复项目包时也不依赖原始底图。
    setDrafts((all) => ({
      ...all,
      preset: {
        ...material.recipe,
        base_id: material.id,
        color: "#ffffff",
        repeat: 1,
        rotation: 0,
      },
    }));
    selectMode("preset");
  };
  const importSource = async (file) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("category", category);
      form.append("origin", "upload");
      const source = await api("/materials/source", {
        method: "POST",
        body: form,
      });
      if (!mounted.current) return;
      setDrafts((all) => ({
        ...all,
        upload: {
          ...sourceRecipe(all.upload, source),
          name:
            file.name.replace(/\.[^.]+$/, "").slice(0, 60) ||
            `我的${label}贴图`,
        },
      }));
      selectMode("upload");
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setUploading(false);
    }
  };
  const startPainting = (seed) => {
    setDrafts((all) => ({
      ...all,
      draw: {
        ...seed.recipe,
        base_id: "",
        origin: "draw",
        color: "#ffffff",
        repeat: 1,
        rotation: 0,
      },
    }));
    latestPaint.current = "";
    setPaintImage("");
    setPaintStatus("loading");
    setPaintSeed({ url: seed.url, nonce: crypto.randomUUID() });
    setPendingSeed(null);
    selectMode("draw");
  };
  const continuePainting = async () => {
    if (!preview || previewBusy) return;
    try {
      const seed = {
        url: await dataUrl(await (await fetch(preview)).blob()),
        recipe: { ...draft },
      };
      const previous = await readArtwork(category).catch(() => null);
      if (!mounted.current) return;
      if (previous?.image || paintImage) setPendingSeed(seed);
      else startPainting(seed);
    } catch (e) {
      setError(e.message);
    }
  };
  const currentSaved =
    hasSource &&
    saved?.mode === mode &&
    saved.signature === JSON.stringify(draft);
  return (
    <section className="surface-studio">
      <header>
        <div>
          <span className="eyebrow">材质创作工作台</span>
          <h1>{label} DIY</h1>
          <p>生成或绘制纹理，实时查看铺贴效果，满意后直接保存。</p>
        </div>
        <div className="surface-save-actions">
          <button onClick={onLibrary}>查看素材库</button>
          <button
            form="surface-design-form"
            type="submit"
            className="primary-button"
            disabled={!!saveReason}
            title={saveReason || "保存当前预览的材质"}
          >
            {busy ? "正在保存…" : "保存到素材库"}
          </button>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      {currentSaved && (
        <p role="status">
          「{saved.name}」已保存，可在素材库和户型生成页面选择。
        </p>
      )}
      <div className="surface-workflow-bar">
        <div
          className="surface-creation-modes"
          role="tablist"
          aria-label="材质创作方式"
        >
          {SURFACE_MODES.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={mode === id}
              onClick={() => selectMode(id)}
            >
              {MODE_LABELS[id]}
            </button>
          ))}
        </div>
        <span>选择创作方式 → 预览与调整 → 保存素材</span>
      </div>
      <input
        hidden
        type="file"
        ref={importPicker}
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          void importSource(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {pendingSeed && (
        <div
          className="surface-replace-prompt"
          role="alertdialog"
          aria-label="更换手绘底图"
        >
          <strong>用当前材质开始绘画？</strong>
          <p>这会替换此用途的手绘草稿。已保存到素材库的材质不受影响。</p>
          <button onClick={() => startPainting(pendingSeed)}>使用新底图</button>
          <button onClick={() => setPendingSeed(null)}>保留原画布</button>
        </div>
      )}
      <div className={`surface-studio-layout creation-${mode}`}>
        {mode === "preset" && (
          <aside className="surface-base-list">
            <h2>从样板开始</h2>
            <div className="surface-base-grid">
              {bases.map((m) => (
                <button
                  key={m.id}
                  disabled={busy}
                  aria-pressed={draft.base_id === m.id}
                  onClick={() =>
                    change({
                      name: `${m.name} · 自定义`,
                      origin: "preset",
                      base_id: m.id,
                      color: m.color,
                      roughness: m.roughness ?? 0.8,
                      optics: m.optics ?? null,
                      repeat: 1,
                      rotation: 0,
                    })
                  }
                >
                  <MaterialSample material={m} />
                  <strong>{m.name}</strong>
                  <small>{m.family}</small>
                </button>
              ))}
            </div>
          </aside>
        )}
        {paintVisited && (
          <div className="surface-creation-panel" hidden={mode !== "draw"}>
            <h2>绘制你的纹理</h2>
            <p className="field-note">
              画布自动同步，可直接调整右侧属性和保存。
            </p>
            <SurfacePainter
              key={paintSession}
              category={category}
              seed={paintSeed}
              onPreview={receivePaint}
              onError={(message) => {
                setPaintStatus("failed");
                setPaintError(message);
              }}
              disabled={busy}
            />
            <p role="status" className="surface-sync-status">
              {paintStatus === "ready"
                ? "画布已同步"
                : paintStatus === "failed"
                  ? paintError
                  : "正在同步画布…"}
              {paintStatus === "failed" && (
                <button
                  onClick={() => {
                    setPaintStatus("pending");
                    setPaintRetry((n) => n + 1);
                    if (!paintImage) setPaintSession((n) => n + 1);
                  }}
                >
                  重试同步
                </button>
              )}
            </p>
          </div>
        )}
        <div className="surface-creation-panel" hidden={mode !== "ai"}>
          <h2>描述你想要的{label}</h2>
          <SurfaceAiCreator category={category} onSelection={onAiSelection} />
        </div>
        {mode === "upload" && (
          <div className="surface-creation-panel surface-upload-panel">
            <h2>上传纹理图片</h2>
            <p>使用自己的纹理、扫描图或拍摄的材质照片。</p>
            <button
              className="primary-button"
              disabled={uploading || busy}
              onClick={() => importPicker.current.click()}
            >
              {uploading
                ? "正在导入…"
                : draft.base_id
                  ? "更换图片"
                  : "选择图片"}
            </button>
            <small>
              PNG / JPG / WebP · 最大 10 MB
              <br />
              图片居中裁成方形；透明部分合成白底。
            </small>
            {draft.base_id && (
              <p>已导入，右侧可直接调整和保存，也可以继续手绘。</p>
            )}
          </div>
        )}
        <div
          className="surface-design-preview"
          aria-busy={
            previewBusy || (mode === "draw" && paintStatus !== "ready")
          }
        >
          <div className="surface-preview-heading">
            <strong>{MODE_LABELS[mode]} · 效果预览</strong>
            {hasSource && (
              <button
                onClick={() => setTileView(!tileView)}
                aria-pressed={tileView}
              >
                {tileView ? "三维效果" : "平铺检查"}
              </button>
            )}
          </div>
          {hasSource ? (
            <>
              <div className="surface-preview-stage">
                {tileView ? (
                  <div
                    className="surface-tile-check"
                    role="img"
                    aria-label="材质三乘三平铺检查"
                    style={{ backgroundImage: `url(${preview})` }}
                  />
                ) : (
                  <SurfacePreview
                    url={preview}
                    roughness={draft.roughness}
                    optics={draft.optics}
                    category={category}
                  />
                )}{" "}
                {(previewBusy ||
                  (mode === "draw" && paintStatus !== "ready")) && (
                  <span className="surface-preview-loading">正在更新材质…</span>
                )}
              </div>
              <h2>{draft.name || `我的${label}材质`}</h2>
              <small>拖动旋转，滚轮缩放 · 预览与保存使用同一张贴图</small>
              {draft.optics?.transmission > 0 && (
                <small>
                  后方色块用于观察透光。整墙应用可作为玻璃隔断；单侧饰面仍有实体墙背衬。
                </small>
              )}
              {mode !== "draw" && (
                <button
                  className="surface-continue-paint"
                  disabled={!preview || previewBusy || !!previewError || busy}
                  onClick={continuePainting}
                >
                  在此基础上手绘
                </button>
              )}
            </>
          ) : (
            <div className="surface-preview-empty">
              <span>{mode === "ai" ? "✦" : "▧"}</span>
              <h2>
                {mode === "ai"
                  ? aiSelection?.status === "running" ||
                    aiSelection?.status === "queued"
                    ? "正在生成你的材质"
                    : "让纹理从想法开始"
                  : mode === "draw"
                    ? "正在准备画布"
                    : "上传一张纹理图片"}
              </h2>
              <p>
                {mode === "ai"
                  ? "在左侧描述材质，完成后将在这里自动展示三维效果。"
                  : mode === "draw"
                    ? "笔画会自动同步到这里。"
                    : "导入后可查看三维铺贴效果。"}
              </p>
            </div>
          )}
          {previewError && (
            <p role="alert">
              {previewError}
              <button onClick={() => setPreviewRetry((n) => n + 1)}>
                重试预览
              </button>
            </p>
          )}
        </div>
        <form
          id="surface-design-form"
          className="surface-design-controls"
          onSubmit={save}
        >
          <h2>材质属性</h2>
          <fieldset disabled={busy}>
            <label>
              材质名称
              <input
                aria-label="材质名称"
                required
                maxLength={60}
                value={draft.name}
                onChange={(e) => change({ name: e.target.value })}
              />
            </label>
            <label>
              表面光泽
              <select
                aria-label="表面光泽"
                value={draft.roughness}
                onChange={(e) => change({ roughness: Number(e.target.value) })}
              >
                {[...new Set([0.03, 0.25, 0.45, 0.8, 0.95, draft.roughness])]
                  .sort()
                  .map((n) => (
                    <option key={n} value={n}>
                      {{
                        0.03: "高光",
                        0.25: "亮面",
                        0.45: "柔光",
                        0.8: "哑光",
                        0.95: "细磨砂",
                      }[n] || `自定义（${n}）`}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              纹理密度 · {draft.repeat} 倍
              <input
                aria-label="纹理密度"
                type="range"
                min="1"
                max="6"
                step="1"
                value={draft.repeat}
                onChange={(e) => change({ repeat: Number(e.target.value) })}
              />
            </label>
            <label>
              铺设方向
              <select
                aria-label="铺设方向"
                value={draft.rotation}
                onChange={(e) => change({ rotation: Number(e.target.value) })}
              >
                {[0, 90, 180, 270].map((n) => (
                  <option key={n} value={n}>
                    {n}°
                  </option>
                ))}
              </select>
            </label>
            <label>
              材质光学效果
              <select
                aria-label="材质光学效果"
                value={
                  draft.optics?.transmission > 0
                    ? "glass"
                    : draft.optics?.metalness > 0.5
                      ? "metal"
                      : "solid"
                }
                onChange={(e) =>
                  change(
                    e.target.value === "glass"
                      ? {
                          optics: {
                            transmission: 0.95,
                            metalness: 0,
                            ior: 1.5,
                            thickness: 0.01,
                          },
                          roughness: 0.03,
                        }
                      : e.target.value === "metal"
                        ? {
                            optics: {
                              transmission: 0,
                              metalness: 1,
                              ior: 1.5,
                              thickness: 0.01,
                            },
                            roughness: 0.2,
                          }
                        : { optics: null },
                  )
                }
              >
                <option value="solid">不透光饰面</option>
                <option value="glass">玻璃透光</option>
                <option value="metal">金属反射</option>
              </select>
            </label>
            {draft.optics && (
              <details open className="surface-optical-controls">
                <summary>光学参数</summary>
                {[
                  ["transmission", "透光率", 0, 1, 0.01],
                  ["metalness", "金属度", 0, 1, 0.01],
                  ["ior", "折射率", 1, 2.5, 0.01],
                  ["thickness", "光学厚度（米）", 0, 0.5, 0.001],
                ].map(([key, title, min, max, step]) => (
                  <label key={key}>
                    {title} · {draft.optics[key]}
                    <input
                      type="range"
                      aria-label={title}
                      min={min}
                      max={max}
                      step={step}
                      value={draft.optics[key]}
                      onChange={(e) =>
                        change({
                          optics: {
                            ...draft.optics,
                            [key]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
                <small>光学厚度仅影响渲染，不会更改墙体几何厚度。</small>
              </details>
            )}
            <details className="surface-tint-options">
              <summary>可选：调整染色</summary>
              <label>
                饰面基色
                <input
                  aria-label="饰面基色"
                  type="color"
                  value={draft.color}
                  onInput={(e) => change({ color: e.target.value })}
                  onChange={(e) => change({ color: e.target.value })}
                />
                <small>白色保留原图；其他颜色叠加在纹理上。</small>
              </label>
              <button
                type="button"
                onClick={() => change({ color: "#ffffff" })}
              >
                还原原色
              </button>
            </details>
          </fieldset>
          <p className="surface-save-hint">
            {saveReason || "保存后可用于户型生成和人工设计。"}
          </p>
          <button className="primary-button" disabled={!!saveReason}>
            {busy ? "正在保存…" : "保存当前材质"}
          </button>
        </form>
      </div>
      <section className="surface-saved">
        <h2>
          我的{label}材质 · {own.length}
        </h2>
        <p>选中素材继续修改，保存为新材质；已使用的方案保持原样。</p>
        <div className="surface-base-grid">
          {own.map((m) => (
            <button key={m.id} disabled={busy} onClick={() => openSaved(m)}>
              <MaterialSample material={m} />
              <strong>{m.name}</strong>
              <small>
                {m.finish} · {m.recipe.repeat} 倍纹理
              </small>
            </button>
          ))}
        </div>
        {!own.length && <p>还没有保存的材质，从上方制作第一款吧。</p>}
      </section>
    </section>
  );
}
