import { useEffect, useId, useRef, useState } from "react";
import {
  Sparkles,
  Plus,
  Trash2,
  Copy,
  Undo2,
  Redo2,
  Save,
  LoaderCircle,
  ArrowLeft,
} from "lucide-react";
import ModelFields from "../components/ModelFields.jsx";
import NumberField from "../editor/NumberField.jsx";
import { useModels } from "../hooks/useModels.js";
import { api } from "../api.js";
import DiyPreview from "./DiyPreview.jsx";
import {
  categories,
  shapes,
  newPart,
  designBounds,
  designIssues,
  promptExamples,
  materialPresets,
} from "./design.js";
import "./diy.css";

const labels = {
  queued: "排队中",
  running: "AI 设计中",
  ready: "可使用",
  failed: "生成失败",
  cancelled: "已取消",
};
const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const copy = (value) => structuredClone(value);

export default function DiyStudio({
  onClose,
  onUse,
  initialDesign = null,
  placementSize = null,
  active = true,
  openAssetRequest = null,
  useLabel = "放入当前户型",
}) {
  const formId = useId();
  const models = useModels({ requiresImage: false });
  const root = useRef(null),
    token = useRef(0),
    operation = useRef(false);
  const [items, setItems] = useState([]),
    [asset, setAsset] = useState(null),
    [search, setSearch] = useState("");
  const [history, setHistory] = useState({
    past: [],
    present: copy(initialDesign),
    future: [],
  });
  const [baseline, setBaseline] = useState(JSON.stringify(initialDesign));
  const [partId, setPartId] = useState(initialDesign?.parts[0]?.id || "");
  const [prompt, setPrompt] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState(null);
  const [partSearch, setPartSearch] = useState("");
  const [requestExpanded, setRequestExpanded] = useState(!initialDesign);
  const [preserveSize, setPreserveSize] = useState(true);
  const design = history.present,
    part = design?.parts.find((p) => p.id === partId);
  const generating = ["queued", "running"].includes(asset?.status);
  const dirty = JSON.stringify(design) !== baseline;
  const issues = design ? designIssues(design) : [];
  const refresh = async () => setItems((await api("/diy/assets")).items);
  const loadValue = (value) => {
    ++token.current;
    setAsset(value);
    const next = value?.design || value?.request?.base || null;
    setHistory({ past: [], present: copy(next), future: [] });
    setBaseline(JSON.stringify(next));
    setPartId(next?.parts[0]?.id || "");
    setNotice("");
    setError("");
    setPrompt(value?.status === "ready" ? "" : value?.request?.prompt || "");
    setPartSearch("");
    setRequestExpanded(
      !next ||
        ["queued", "running", "failed", "cancelled"].includes(value?.status),
    );
  };
  useEffect(() => {
    let alive = true;
    api("/diy/assets")
      .then((v) => {
        if (alive) setItems(v.items);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      ++token.current;
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (design && !design.parts.some((p) => p.id === partId))
      setPartId(design.parts[0]?.id || "");
  }, [design, partId]);
  const libraryGenerating = items.some((i) =>
    ["queued", "running"].includes(i.status),
  );
  useEffect(() => {
    if (!libraryGenerating) return;
    let alive = true,
      timer;
    const poll = async () => {
      try {
        const value = await api("/diy/assets");
        if (alive) setItems(value.items);
      } finally {
        if (alive) timer = setTimeout(() => poll().catch(() => {}), 2500);
      }
    };
    timer = setTimeout(() => poll().catch(() => {}), 2500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [libraryGenerating]);
  useEffect(() => {
    if (!generating) return;
    let alive = true,
      timer;
    const poll = async () => {
      try {
        const value = await api(`/diy/assets/${asset.id}`);
        if (!alive) return;
        if (!["queued", "running"].includes(value.status)) {
          loadValue(value);
          await refresh();
        } else {
          setAsset(value);
          timer = setTimeout(poll, 1500);
        }
      } catch (e) {
        if (alive) {
          setError(e.message);
          timer = setTimeout(poll, 4000);
        }
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [asset?.id, generating]);
  const commit = (update) => {
    setHistory((h) => {
      const next =
        typeof update === "function" ? update(copy(h.present)) : update;
      if (JSON.stringify(next) === JSON.stringify(h.present)) return h;
      return {
        past: [...h.past, h.present].slice(-60),
        present: next,
        future: [],
      };
    });
    setError("");
    setNotice("");
  };
  const undo = () =>
    setHistory((h) =>
      h.past.length
        ? {
            past: h.past.slice(0, -1),
            present: h.past.at(-1),
            future: [...h.future, h.present],
          }
        : h,
    );
  const redo = () =>
    setHistory((h) =>
      h.future.length
        ? {
            past: [...h.past, h.present],
            present: h.future.at(-1),
            future: h.future.slice(0, -1),
          }
        : h,
    );
  const patchPart = (key, value) =>
    commit((d) => {
      d.parts.find((p) => p.id === partId)[key] = value;
      return d;
    });
  const inputValid = () => {
    const invalid = root.current?.querySelector(
      'input:invalid, input[aria-invalid="true"]',
    );
    if (invalid) {
      invalid.focus();
      setError("请先修正标红的数值；按 Esc 可恢复原值。");
      return false;
    }
    if (issues.length) {
      setError(issues[0]);
      return false;
    }
    return true;
  };
  const act = async (fn) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const guard = (run, label = "舍弃未保存修改") => {
    if (
      dirty ||
      root.current?.querySelector('input:invalid, input[aria-invalid="true"]')
    )
      setPending({ run, label });
    else run();
  };
  const open = (entry) =>
    guard(() =>
      act(async () => {
        const sequence = ++token.current;
        const value = await api(`/diy/assets/${entry.id}`);
        if (sequence === token.current) loadValue(value);
      }),
    );
  const createBlank = () =>
    guard(() => {
      loadValue(null);
      const p = newPart();
      commit({ name: "我的 DIY 家具", category: "furniture", parts: [p] });
      setPartId(p.id);
    });
  const startNew = (text = "") =>
    guard(() => {
      loadValue(null);
      setPrompt(text);
    });
  const save = async (asNew = false) => {
    if (!design || !inputValid()) return;
    await act(async () => {
      const path =
        asset?.status === "ready" && !asNew
          ? `/diy/assets/${asset.id}/save`
          : "/diy/assets";
      const value = await api(
        path,
        json({ design, revision: asset?.revision || 0 }),
      );
      loadValue(value);
      setNotice("已保存到素材库，可在人工设计中使用。");
      await refresh();
    });
  };
  const generate = () => {
    if (!prompt.trim() || (design && !inputValid())) return;
    act(async () => {
      const value = await api(
        "/diy/generate",
        json({
          prompt: prompt.trim(),
          model: models.model,
          reasoning_effort: models.effort || null,
          base: design,
        }),
      );
      loadValue(value);
      await refresh();
    });
  };
  const addPart = () => {
    if (!design || design.parts.length >= 48) return;
    const next = newPart();
    commit((d) => {
      d.parts.push(next);
      return d;
    });
    setPartId(next.id);
    setPartSearch("");
  };
  const numbers = [
    ["部件宽度", "width", 0.01, 6],
    ["部件进深", "depth", 0.01, 6],
    ["部件高度", "height", 0.01, 3],
    ["左右位置 X", "x", -6, 6],
    ["前后位置 Y", "y", -6, 6],
    ["底部离地 Z", "z", 0, 3],
    ["部件朝向", "rotation", -360, 360, "°"],
    ["粗糙度", "roughness", 0, 1, ""],
    ["金属感", "metallic", 0, 1, ""],
  ];
  const dimensions =
    design && !issues.length ? designBounds(design).dimensions : null;
  const requestOpen = useRef(null);
  useEffect(() => {
    if (!openAssetRequest || requestOpen.current === openAssetRequest) return;
    requestOpen.current = openAssetRequest;
    open({ id: openAssetRequest.id });
  }, [openAssetRequest]);
  const shortcut = (e) => {
    if (!active || busy || generating || pending || !(e.ctrlKey || e.metaKey))
      return;
    const key = e.key.toLowerCase();
    if (key === "s") {
      e.preventDefault();
      e.target.blur();
      requestAnimationFrame(() =>
        root.current?.querySelector("[data-diy-save]")?.click(),
      );
    }
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (key === "z" || key === "y") {
      e.preventDefault();
      e.stopPropagation();
      key === "y" || e.shiftKey ? redo() : undo();
    }
  };
  return (
    <section
      className="diy-page"
      aria-label="家具 DIY 页面"
      onKeyDown={shortcut}
    >
      <header className="diy-page-heading">
        <div>
          <span>创作工作台</span>
          <h1>家具 DIY</h1>
          <p>从一个想法，到可放入户型的三维家具。</p>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => (onUse ? guard(onClose, "舍弃修改并返回") : onClose())}
        >
          <ArrowLeft size={15} />
          {onUse ? "返回人工设计" : "返回工作台"}
        </button>
      </header>
      <div ref={root} className="diy-studio">
        {pending && (
          <div className="diy-confirm" role="alert">
            <span>{pending.message || "当前有未保存的修改，是否继续？"}</span>
            <button
              onClick={() => {
                const action = pending.run;
                setPending(null);
                action();
              }}
            >
              {pending.label}
            </button>
            <button onClick={() => setPending(null)}>返回编辑</button>
          </div>
        )}
        <div className="diy-columns">
          <aside className="diy-library">
            <h3>我的素材库</h3>
            <p>素材独立保存，可反复放入不同方案。</p>
            <button
              className="primary-button diy-new"
              disabled={busy}
              onClick={() => startNew()}
            >
              <Sparkles size={14} />
              新建 AI 设计
            </button>
            <input
              type="search"
              aria-label="搜索 DIY 素材"
              placeholder="搜索素材名称"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className="secondary-button"
              disabled={busy}
              onClick={createBlank}
            >
              <Plus size={14} />
              手动新建素材
            </button>
            <div className="diy-assets">
              {items
                .filter((i) => i.name.includes(search))
                .map((i) => (
                  <button
                    key={i.id}
                    disabled={busy}
                    aria-pressed={asset?.id === i.id}
                    onClick={() => open(i)}
                  >
                    <strong>{i.name}</strong>
                    <small>
                      {labels[i.status]}{" "}
                      {i.dimensions?.map((n) => n.toFixed(2)).join(" × ")}
                      {i.dimensions ? " m" : ""}
                    </small>
                  </button>
                ))}
            </div>
            {!items.length && (
              <p>还没有素材。右侧输入描述开始生成，也可以手动搭建。</p>
            )}
            {!!items.length && !items.some((i) => i.name.includes(search)) && (
              <p>没有匹配的素材，试试其他名称。</p>
            )}
          </aside>
          <section className="diy-workbench">
            <details
              className="diy-request-shell"
              open={requestExpanded}
              onToggle={(e) => setRequestExpanded(e.currentTarget.open)}
            >
              <summary>
                {generating
                  ? "AI 正在设计 · 展开查看进度"
                  : design
                    ? "AI 修改助手 · 描述想改哪里"
                    : "AI 设计助手 · 描述你的想法"}
              </summary>
              <div className="diy-request">
                <label htmlFor={`${formId}-prompt`}>
                  {design ? "告诉 AI 还想怎么改" : "想做什么家具或构件？"}
                </label>
                <textarea
                  id={`${formId}-prompt`}
                  maxLength={3000}
                  disabled={busy || generating}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="例如：一个1.2米宽的原木玄关柜，双开门、黄铜把手，底部留出放鞋空间"
                />
                {!design && !generating && (
                  <div className="diy-examples" aria-label="设计描述示例">
                    {promptExamples.map((example) => (
                      <button
                        key={example.name}
                        disabled={busy}
                        onClick={() => setPrompt(example.text)}
                      >
                        {example.name}
                      </button>
                    ))}
                  </div>
                )}
                {design && asset?.request?.prompt && (
                  <details className="diy-original-request">
                    <summary>查看原始设计要求</summary>
                    <p>{asset.request.prompt}</p>
                  </details>
                )}
                <details className="diy-models">
                  <summary>
                    模型与推理强度 · {models.model || "正在读取"}
                  </summary>
                  <ModelFields models={models} idPrefix={formId} />
                </details>
                <div className="diy-generate-row">
                  <button
                    className="primary-button"
                    disabled={
                      busy || generating || !models.ready || !prompt.trim()
                    }
                    onClick={generate}
                  >
                    {generating ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Sparkles size={15} />
                    )}{" "}
                    {generating
                      ? labels[asset.status]
                      : design
                        ? "AI 生成修改版"
                        : "AI 生成素材"}
                  </button>
                  {generating && (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          loadValue(
                            await api(
                              `/diy/assets/${asset.id}/cancel`,
                              json({}),
                            ),
                          );
                          await refresh();
                        })
                      }
                    >
                      取消生成
                    </button>
                  )}
                </div>
                {generating && (
                  <p role="status">
                    任务已保存，关闭此窗口仍会继续生成；重新打开素材库可查看进度。
                  </p>
                )}
                {["failed", "cancelled"].includes(asset?.status) && (
                  <p role="alert">{asset.error} 修改描述后可重新生成。</p>
                )}
              </div>
            </details>
            <DiyPreview
              assetKey={asset?.id || "draft"}
              design={design}
              selected={partId}
              onSelect={(id) => {
                if (
                  !root.current?.querySelector(
                    'input:invalid, input[aria-invalid="true"]',
                  )
                )
                  setPartId(id);
                else setError("请先修正当前部件的数值，再选择其他部件。");
              }}
            />
            <div className="diy-status">
              <span>
                {dimensions
                  ? `${design.parts.length} 个部件 · ${dimensions.map((n) => n.toFixed(2)).join(" × ")} m`
                  : "等待生成或选择素材"}
              </span>
              <span>方体、圆柱、椭球组合</span>
            </div>
          </section>
          <aside className="diy-properties">
            <h3>微调素材</h3>
            {!design ? (
              <p>生成后可点选三维部件，调整尺寸、位置和材质。</p>
            ) : (
              <fieldset disabled={busy || generating}>
                <label>
                  素材名称
                  <input
                    aria-label="DIY 素材名称"
                    value={design.name}
                    maxLength={60}
                    onChange={(e) =>
                      commit((d) => ({ ...d, name: e.target.value }))
                    }
                  />
                </label>
                <label>
                  素材分类
                  <select
                    value={design.category}
                    onChange={(e) =>
                      commit((d) => ({ ...d, category: e.target.value }))
                    }
                  >
                    {Object.entries(categories).map(([v, n]) => (
                      <option key={v} value={v}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                {design.category === "wall_panel" && (
                  <p>
                    此素材是背景墙或屏风等装饰构件。建筑墙与门窗请在人工设计的墙体工具中调整。
                  </p>
                )}
                <div className="diy-part-toolbar">
                  <h4>部件 {design.parts.length}/48</h4>
                  <button
                    aria-label="添加 DIY 部件"
                    disabled={design.parts.length >= 48}
                    onClick={addPart}
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    aria-label="撤销 DIY 修改"
                    disabled={!history.past.length}
                    onClick={undo}
                  >
                    <Undo2 size={16} />
                  </button>
                  <button
                    aria-label="重做 DIY 修改"
                    disabled={!history.future.length}
                    onClick={redo}
                  >
                    <Redo2 size={16} />
                  </button>
                </div>
                <input
                  type="search"
                  aria-label="搜索部件"
                  placeholder="搜索柜门、把手、桌腿…"
                  value={partSearch}
                  onChange={(e) => setPartSearch(e.target.value)}
                />
                <div className="diy-parts-list" aria-label="部件列表">
                  {design.parts
                    .filter((p) => p.name.includes(partSearch))
                    .map((p) => (
                      <button
                        key={p.id}
                        aria-pressed={partId === p.id}
                        onClick={() => {
                          if (inputValid()) setPartId(p.id);
                        }}
                      >
                        <i style={{ background: p.color }} />
                        <span>{p.name}</span>
                        <small>{shapes[p.shape].split(" / ")[0]}</small>
                      </button>
                    ))}
                  {!design.parts.some((p) => p.name.includes(partSearch)) && (
                    <p>没有匹配的部件。</p>
                  )}
                </div>
                {part && (
                  <div key={part.id} className="diy-part-fields">
                    <label>
                      部件名称
                      <input
                        aria-label="DIY 部件名称"
                        maxLength={60}
                        value={part.name}
                        onChange={(e) => patchPart("name", e.target.value)}
                      />
                    </label>
                    <label>
                      部件形状
                      <select
                        aria-label="DIY 部件形状"
                        value={part.shape}
                        onChange={(e) => patchPart("shape", e.target.value)}
                      >
                        {Object.entries(shapes).map(([v, n]) => (
                          <option key={v} value={v}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="edit-number-grid">
                      {numbers.map(([label, key, min, max, unit = "m"]) => (
                        <NumberField
                          key={key}
                          label={label}
                          value={part[key]}
                          min={min}
                          max={max}
                          unit={unit}
                          onCommit={(n) => patchPart(key, n)}
                        />
                      ))}
                    </div>
                    <label className="diy-color">
                      部件颜色
                      <input
                        aria-label="DIY 部件颜色"
                        type="color"
                        value={part.color}
                        onChange={(e) => patchPart("color", e.target.value)}
                      />
                      <span>{part.color}</span>
                    </label>
                    <div className="diy-materials" aria-label="部件材质预设">
                      {materialPresets.map(({ name, ...material }) => (
                        <button
                          key={name}
                          title={name}
                          aria-label={`应用${name}材质`}
                          onClick={() =>
                            commit((d) => {
                              Object.assign(
                                d.parts.find((p) => p.id === partId),
                                material,
                              );
                              return d;
                            })
                          }
                        >
                          <i style={{ background: material.color }} />
                          {name}
                        </button>
                      ))}
                    </div>
                    <div className="diy-part-actions">
                      <button
                        disabled={design.parts.length >= 48}
                        onClick={() => {
                          const p = {
                            ...copy(part),
                            id: crypto.randomUUID(),
                            name: `${part.name.slice(0, 55)} 副本`,
                          };
                          commit((d) => {
                            d.parts.push(p);
                            return d;
                          });
                          setPartId(p.id);
                        }}
                      >
                        <Copy size={13} />
                        复制部件
                      </button>
                      <button
                        disabled={design.parts.length <= 1}
                        onClick={() => {
                          commit((d) => ({
                            ...d,
                            parts: d.parts.filter((p) => p.id !== part.id),
                          }));
                          setPartId(
                            design.parts.find((p) => p.id !== part.id)?.id ||
                              "",
                          );
                        }}
                      >
                        <Trash2 size={13} />
                        删除部件
                      </button>
                    </div>
                  </div>
                )}
                <p>
                  尺寸为部件本体尺寸；底部自动落地，组合居中。整体尺寸随部件变化，放入户型后还能整体缩放、移动和旋转。
                </p>
              </fieldset>
            )}
          </aside>
        </div>
        {(error || issues.length > 0) && (
          <div className="diy-error" role="alert">
            {error || issues[0]}
          </div>
        )}
        {notice && (
          <div className="diy-notice" role="status">
            {notice}
          </div>
        )}
        <footer className="diy-footer">
          <span>
            {generating
              ? "AI 生成中"
              : dirty
                ? "有未保存的修改"
                : asset?.status === "ready"
                  ? `素材版本 ${asset.revision}`
                  : "保存后可反复使用"}
          </span>
          {asset && (
            <button
              className="text-button"
              disabled={busy || generating}
              onClick={() =>
                setPending({
                  label: "移出素材库",
                  message:
                    "确认移出此素材？已放入户型的副本不会受影响。当前未保存的修改将被舍弃。",
                  run: () =>
                    act(async () => {
                      await api(`/diy/assets/${asset.id}/archive`, json({}));
                      loadValue(null);
                      await refresh();
                    }),
                })
              }
            >
              移出素材库
            </button>
          )}
          {asset?.status === "ready" && (
            <a href={`/api/diy/assets/${asset.id}/model.glb`} download>
              下载已保存 GLB
            </a>
          )}
          <button
            className="secondary-button"
            disabled={busy || generating || !design || !!issues.length}
            onClick={() => save(true)}
          >
            另存为新素材
          </button>
          <button
            className="primary-button"
            data-diy-save
            disabled={
              busy ||
              generating ||
              !design ||
              !!issues.length ||
              (!dirty && asset?.status === "ready")
            }
            onClick={() => save()}
          >
            <Save size={14} />
            保存素材
          </button>
          {onUse && (
            <button
              className="primary-button"
              disabled={busy || generating || !design || !!issues.length}
              onClick={() => {
                if (inputValid())
                  act(async () => {
                    await onUse(copy(design), { preserveSize });
                    onClose();
                  });
              }}
            >
              {useLabel}
            </button>
          )}
        </footer>
        {placementSize && (
          <label className="diy-preserve-size">
            <input
              type="checkbox"
              checked={preserveSize}
              onChange={(e) => setPreserveSize(e.target.checked)}
            />
            保留户型中的整体尺寸（
            {placementSize.map((n) => n.toFixed(2)).join(" × ")}{" "}
            m）；取消勾选则使用当前部件组合尺寸。
          </label>
        )}
        {!onUse && (
          <p className="diy-footnote">
            保存后，在成功任务的「人工设计 → 家具 → DIY
            素材库」放入户型；放入的是独立副本。
          </p>
        )}
      </div>
    </section>
  );
}
