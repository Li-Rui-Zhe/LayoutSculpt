import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
  Armchair,
  Box,
  ImagePlus,
  MousePointer2,
  SlidersHorizontal,
  Palette,
  Table2,
  PanelsTopLeft,
} from "lucide-react";
import ModelFields from "../components/ModelFields.jsx";
import NumberField from "../editor/NumberField.jsx";
import { useModels } from "../hooks/useModels.js";
import { api } from "../api.js";
import DiyPreview from "./DiyPreview.jsx";
import DiyReferenceImage from "./DiyReferenceImage.jsx";
import { furnitureTemplate } from "./templates.js";
import { useDraftSync } from "../hooks/useDraftSync.js";
import { writeContext, readContext } from "../hooks/urlContext.js";
import ColorDesigner from "./ColorDesigner.jsx";
import PartTree from "./PartTree.jsx";
import GroupTransform from "./GroupTransform.jsx";
import { commitDesign } from "./colors.js";
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
  saveBeforeUse = false,
  initialDesign = null,
  placementSize = null,
  active = true,
  openAssetRequest = null,
  useLabel = "放入当前户型",
}) {
  const formId = useId();
  const linkedPart = useRef(readContext("part"));
  const [referenceId, setReferenceId] = useState(null);
  const [referenceVersion, setReferenceVersion] = useState(0);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const models = useModels({ requiresImage: !!referenceId });
  const root = useRef(null),
    token = useRef(0),
    operation = useRef(false);
  const [draftMeta, setDraftMeta] = useState(null);
  const [recoverable, setRecoverable] = useState(null);
  const [versions, setVersions] = useState([]),
    [compareBase, setCompareBase] = useState(false),
    [archivedItems, setArchivedItems] = useState([]);
  const [modifyScope, setModifyScope] = useState("all");
  const [items, setItems] = useState([]),
    [asset, setAsset] = useState(null),
    [search, setSearch] = useState("");
  const [history, setHistory] = useState({
    past: [],
    present: copy(initialDesign),
    future: [],
  });
  const [baseline, setBaseline] = useState(JSON.stringify(initialDesign));
  const [partId, setPartId] = useState(() =>
    readContext("part", initialDesign?.parts[0]?.id || ""),
  );
  useEffect(() => {
    if (active && !initialDesign && history.present)
      writeContext({ diyAsset: asset?.id, part: partId });
  }, [active, asset?.id, partId, initialDesign, !!history.present]);
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
  const designRef = useRef(design);
  designRef.current = design;
  const [hasPendingInput, setHasPendingInput] = useState(false);
  const syncInputState = () => {
    setHasPendingInput(
      [
        ...(root.current?.querySelectorAll("input[data-number-value]") || []),
      ].some((input) => input.value !== input.dataset.numberValue),
    );
  };
  const generating = ["queued", "running"].includes(asset?.status);
  const draftKey = `diy:${asset?.id || "new"}`;
  const draftSync = useDraftSync(
    draftKey,
    design,
    !initialDesign && !generating && draftMeta?.key === draftKey
      ? draftMeta.revision
      : null,
    (merged) => setHistory({ past: [], present: merged, future: [] }),
  );
  useEffect(() => {
    let alive = true;
    setRecoverable(null);
    setDraftMeta(null);
    if (initialDesign || generating) return;
    let cached = null;
    try {
      cached = JSON.parse(localStorage.getItem(`diy-cache:${draftKey}`));
    } catch {}
    api(`/drafts/${draftKey}`)
      .then((value) => {
        if (
          cached?.document &&
          (!value.updated_at || cached.updated_at > value.updated_at)
        )
          value = { ...value, document: cached.document };
        if (!alive) return;
        if (
          value.document &&
          !designIssues(value.document).length &&
          JSON.stringify(value.document) !== JSON.stringify(designRef.current)
        )
          setRecoverable({ ...value, key: draftKey });
        else setDraftMeta({ key: draftKey, revision: value.revision });
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [draftKey, generating]);
  useEffect(() => {
    if (initialDesign || generating || !design || draftMeta?.key !== draftKey)
      return;
    try {
      localStorage.setItem(
        `diy-cache:${draftKey}`,
        JSON.stringify({
          document: design,
          updated_at: new Date().toISOString(),
        }),
      );
    } catch {
      setError("浏览器草稿缓存空间不足，请及时保存素材");
    }
  }, [design, draftKey, draftMeta, initialDesign, generating]);
  useEffect(() => {
    setVersions([]);
    setCompareBase(false);
    if (asset?.status !== "ready") return;
    let alive = true;
    api(`/diy/assets/${asset.id}/history`)
      .then((v) => {
        if (alive) setVersions(v.items);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [asset?.id, asset?.revision]);
  const dirty = JSON.stringify(design) !== baseline;
  const unsaved = dirty || hasPendingInput;
  const issues = design ? designIssues(design) : [];
  const refresh = async () => setItems((await api("/diy/assets")).items);
  const loadValue = (value) => {
    ++token.current;
    setAsset(value);
    const next = value?.design || value?.request?.base || null;
    setHistory({ past: [], present: copy(next), future: [] });
    setBaseline(JSON.stringify(next));
    setHasPendingInput(false);
    setPartId(
      next?.parts.some((p) => p.id === linkedPart.current)
        ? linkedPart.current
        : next?.parts[0]?.id || "",
    );
    linkedPart.current = "";
    setNotice("");
    setError("");
    setPrompt(value?.status === "ready" ? "" : value?.request?.prompt || "");
    setReferenceId(value?.request?.reference_id || null);
    setReferenceVersion((n) => n + 1);
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
    if (!unsaved) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
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
  const commit = (update, group) => {
    const next =
      typeof update === "function" ? update(copy(history.present)) : update;
    for (const previous of history.present?.parts || []) {
      if (!previous.edit_locked) continue;
      const after = next?.parts.find((p) => p.id === previous.id);
      const stable = (p) =>
        Object.fromEntries(
          Object.entries(p).filter(
            ([k]) => !["edit_locked", "edit_hidden"].includes(k),
          ),
        );
      if (
        !after ||
        JSON.stringify(stable(previous)) !== JSON.stringify(stable(after))
      ) {
        setError("操作涉及已锁定部件，请先解锁。");
        return false;
      }
    }
    setHistory((h) => {
      return commitDesign(h, next, group);
    });
    setError("");
    setNotice("");
    return true;
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
      const p = d.parts.find((p) => p.id === partId);
      if (!p.edit_locked || key === "edit_locked" || key === "edit_hidden")
        p[key] = value;
      return d;
    });
  const inputValid = () => {
    // 数值输入按失焦提交；先完成提交，再读取最新设计，避免保存旧值。
    const focused = document.activeElement;
    if (root.current?.contains(focused) && focused.matches("input")) {
      flushSync(() => focused.blur());
    }
    const invalid = root.current?.querySelector(
      'input:invalid, input[aria-invalid="true"]',
    );
    if (invalid) {
      invalid.focus();
      setError("请先修正标红的输入；按 Esc 可恢复原值。");
      return false;
    }
    const currentIssues = designRef.current
      ? designIssues(designRef.current)
      : [];
    if (currentIssues.length) {
      setError(currentIssues[0]);
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
      unsaved ||
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
    const current = copy(designRef.current);
    if (
      !asNew &&
      asset?.status === "ready" &&
      JSON.stringify(current) === baseline
    ) {
      setNotice("当前素材已保存，没有待保存的修改。");
      return;
    }
    await act(async () => {
      const path =
        asset?.status === "ready" && !asNew
          ? `/diy/assets/${asset.id}/save`
          : "/diy/assets";
      const value = await api(
        path,
        json({ design: current, revision: asset?.revision || 0 }),
      );
      loadValue(value);
      setNotice("已保存到素材库，可在人工设计中使用。");
      await refresh();
    });
  };
  const generate = () => {
    if (
      referenceUploading ||
      !models.ready ||
      (!prompt.trim() && !referenceId) ||
      (design && !inputValid())
    )
      return;
    const current = designRef.current;
    act(async () => {
      const value = await api(
        "/diy/generate",
        json({
          prompt: `${prompt.trim()}${modifyScope === "selected" && part ? `\n只修改部件 ${part.id}（${part.name}），其余部件的尺寸、位置与材质必须保持不变。` : ""}${preserveSize && design ? "\n保持家具整体宽深高不变。" : ""}`,
          model: models.model,
          reasoning_effort: models.effort || null,
          base: current,
          reference_id: referenceId,
          target_part_id: modifyScope === "selected" ? part?.id : null,
          preserve_dimensions: !!design && preserveSize,
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
  const startTemplate = (id) =>
    guard(() => {
      loadValue(null);
      const next = furnitureTemplate(id);
      commit(next);
      setPartId(next.parts[0].id);
      setRequestExpanded(false);
    });
  return (
    <section
      className="diy-page"
      aria-label="家具 DIY 页面"
      onKeyDown={shortcut}
    >
      <header className="diy-page-heading">
        <div>
          <span className="creative-eyebrow">FURNITURE STUDIO</span>
          <h1>家具 DIY</h1>
          <p>让生活里的灵感，成为家中的一件家具。</p>
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
      <div
        ref={root}
        className="diy-studio"
        onChangeCapture={syncInputState}
        onBlurCapture={() => requestAnimationFrame(syncInputState)}
      >
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
            <div className="creative-panel-heading">
              <Sparkles size={16} />
              <h3>设计助手</h3>
              <span>AI 创作</span>
            </div>
            <p className="diy-sidebar-intro">
              描述灵感，或用模板开始一件新家具。
            </p>
            <div className="diy-creation-actions">
              <button
                className="primary-button diy-new"
                disabled={busy}
                onClick={() => startNew()}
              >
                <Sparkles size={14} />
                新建 AI 设计
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={createBlank}
              >
                <Plus size={14} />
                空白设计
              </button>
            </div>
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
                  aria-label={
                    design ? "告诉 AI 还想怎么改" : "描述想设计的家具"
                  }
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
                <details className="diy-reference-disclosure">
                  <summary>
                    <ImagePlus size={14} />
                    添加参考图片 <small>可选</small>
                  </summary>
                  <DiyReferenceImage
                    key={`${asset?.id || "new"}:${referenceVersion}`}
                    value={referenceId}
                    onChange={setReferenceId}
                    disabled={busy || generating}
                    onBusyChange={setReferenceUploading}
                  />
                </details>
                {design && asset?.request?.prompt && (
                  <details className="diy-original-request">
                    <summary>查看原始设计要求</summary>
                    <p>{asset.request.prompt}</p>
                  </details>
                )}
                <details className="diy-models">
                  <summary>
                    {models.provider === "deepseek" ? "DeepSeek" : "Codex"} ·{" "}
                    {models.selected?.name || "模型与推理强度"}
                  </summary>
                  <ModelFields
                    models={models}
                    idPrefix={formId}
                    purpose="diy"
                  />
                </details>
                <div className="diy-generate-row">
                  <button
                    className="primary-button"
                    disabled={
                      busy ||
                      generating ||
                      referenceUploading ||
                      !models.ready ||
                      (!prompt.trim() && !referenceId)
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
                  <div>
                    <p role="alert">{asset.error} 修改描述后可重新生成。</p>
                    <button
                      disabled={busy}
                      onClick={() =>
                        guard(() =>
                          act(async () => {
                            const value = await api(
                              `/diy/assets/${asset.id}/retry`,
                              json({}),
                            );
                            loadValue(value);
                            await refresh();
                          }),
                        )
                      }
                    >
                      按原参数重新生成
                    </button>
                  </div>
                )}
              </div>
            </details>
            <div className="diy-templates">
              <h4>
                从模板开始 <span>无需等待</span>
              </h4>
              <div>
                {[
                  ["table", "餐桌", Table2],
                  ["cabinet", "玄关柜", PanelsTopLeft],
                  ["chair", "餐椅", Armchair],
                ].map(([id, title, Icon]) => (
                  <button
                    key={id}
                    disabled={busy || generating}
                    onClick={() => startTemplate(id)}
                  >
                    <Icon size={22} />
                    <span>{title}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="diy-personal-heading">
              <h3>我的素材</h3>
              <span>{items.length}</span>
            </div>
            <input
              type="search"
              aria-label="搜索 DIY 素材"
              placeholder="搜索已保存的素材"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
              <p className="diy-library-empty">
                <Box size={20} />
                保存后的家具会出现在这里，随时继续创作。
              </p>
            )}
            {!!items.length && !items.some((i) => i.name.includes(search)) && (
              <p>没有匹配的素材，试试其他名称。</p>
            )}
            <details>
              <summary
                onClick={() =>
                  api("/diy/assets?archived=true")
                    .then((v) => setArchivedItems(v.items))
                    .catch((e) => setError(e.message))
                }
              >
                已移出素材 · 可恢复
              </summary>
              {archivedItems.map((i) => (
                <div key={i.id}>
                  <span>{i.name}</span>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await api(`/diy/assets/${i.id}/restore`, {
                          method: "POST",
                        });
                        setArchivedItems((v) => v.filter((a) => a.id !== i.id));
                        await refresh();
                      })
                    }
                  >
                    恢复
                  </button>
                </div>
              ))}
            </details>{" "}
          </aside>
          <section className="diy-workbench">
            <div className="diy-canvas-heading">
              <span>
                <Box size={16} />
                三维预览
              </span>
              <small>
                <i />
                {design ? "实时编辑" : "你的创作空间"}
              </small>
            </div>
            {recoverable && (
              <div className="workspace-note">
                另有本机草稿尚未应用。
                {design
                  ? `当前显示的是${dirty ? "正在编辑的内容" : "已保存版本"}。`
                  : "可恢复后继续创作。"}
                <button
                  onClick={() => {
                    if (!commit(recoverable.document)) return;
                    setPartId(recoverable.document.parts[0].id);
                    setDraftMeta({
                      key: draftKey,
                      revision: recoverable.revision,
                    });
                    setRecoverable(null);
                  }}
                >
                  恢复草稿继续编辑
                </button>
                <button
                  onClick={() => {
                    setDraftMeta({
                      key: draftKey,
                      revision: recoverable.revision,
                    });
                    setRecoverable(null);
                  }}
                >
                  保留当前内容
                </button>
              </div>
            )}
            {draftSync.error && <p role="alert">{draftSync.error}</p>}
            {design && (
              <label className="diy-modify-scope">
                <input
                  type="checkbox"
                  checked={preserveSize}
                  onChange={(e) => setPreserveSize(e.target.checked)}
                />{" "}
                AI 保持整体尺寸 · 修改范围{" "}
                <select
                  value={modifyScope}
                  onChange={(e) => setModifyScope(e.target.value)}
                >
                  <option value="all">整个家具</option>
                  <option value="selected">仅选中部件</option>
                </select>
              </label>
            )}
            {asset?.request?.base && (
              <button
                aria-pressed={compareBase}
                onClick={() => setCompareBase(!compareBase)}
              >
                {compareBase ? "返回 AI 修改后" : "查看 AI 修改前"}
              </button>
            )}
            <DiyPreview
              emptyContent={
                <div className="diy-canvas-welcome">
                  <div className="diy-welcome-symbol">
                    <Armchair size={42} strokeWidth={1.3} />
                    <Sparkles size={16} />
                  </div>
                  <span className="creative-eyebrow">MADE BY YOU</span>
                  <h2>好家具，从一个想法开始</h2>
                  <p>
                    在左侧描述理想中的家具，
                    <br />
                    或选一个模板，让灵感先有个样子。
                  </p>
                  <button
                    className="secondary-button"
                    disabled={busy || generating}
                    onClick={() => startTemplate("cabinet")}
                  >
                    试试玄关柜模板 <Plus size={14} />
                  </button>
                </div>
              }
              assetKey={asset?.id || "draft"}
              design={compareBase ? asset.request.base : design}
              selected={compareBase ? null : partId}
              onTransform={
                compareBase || busy || generating
                  ? undefined
                  : (id, change) => {
                      const next = copy(design),
                        p = next.parts.find((p) => p.id === id);
                      if (!p || p.edit_locked) return false;
                      Object.assign(p, change);
                      const errors = designIssues(next);
                      if (errors.length) {
                        setError(errors[0]);
                        return false;
                      }
                      commit(next);
                      return true;
                    }
              }
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
              <span>圆角、面板、圆柱与软包部件</span>
            </div>
          </section>
          <aside className="diy-properties">
            <div className="creative-panel-heading">
              <SlidersHorizontal size={16} />
              <h3>设计属性</h3>
            </div>
            {design && (
              <details className="diy-finish-panel">
                <summary>
                  <Palette size={15} />
                  材质与饰面 <span>展开搭配</span>
                </summary>
                <ColorDesigner
                  key={`${asset?.id || "draft"}:${baseline}`}
                  design={design}
                  partId={partId}
                  disabled={busy || generating}
                  onCommit={commit}
                />
              </details>
            )}
            {design && <h3 className="diy-detail-heading">部件与尺寸</h3>}
            {!!versions.length && (
              <label>
                历史版本
                <select
                  aria-label="恢复 DIY 历史版本"
                  value=""
                  onChange={(e) => {
                    const v = versions.find(
                      (v) => String(v.revision) === e.target.value,
                    );
                    if (v)
                      guard(() => {
                        commit(v.design);
                        setNotice(
                          "已恢复历史造型为当前草稿，保存后生成新修订。",
                        );
                      });
                  }}
                >
                  <option value="">选择历史版本恢复</option>
                  {versions.map((v) => (
                    <option key={v.revision} value={v.revision}>
                      修订 {v.revision} ·{" "}
                      {new Date(v.created_at).toLocaleString("zh-CN")}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!design ? (
              <div className="diy-inspector-empty">
                <div className="diy-inspector-symbol">
                  <SlidersHorizontal size={26} strokeWidth={1.4} />
                </div>
                <h4>让细节，恰到好处</h4>
                <p>创建设计后，在这里完善每一处细节。</p>
                <ol>
                  <li>
                    <MousePointer2 size={17} />
                    <div>
                      <strong>选中一个部件</strong>
                      <span>在三维画面中直接点选</span>
                    </div>
                  </li>
                  <li>
                    <SlidersHorizontal size={17} />
                    <div>
                      <strong>调整造型与尺寸</strong>
                      <span>移动、旋转，找到合适的比例</span>
                    </div>
                  </li>
                  <li>
                    <Palette size={17} />
                    <div>
                      <strong>搭配喜欢的材质</strong>
                      <span>木材、布艺与金属，自由组合</span>
                    </div>
                  </li>
                </ol>
              </div>
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
                <PartTree
                  parts={design.parts}
                  query={partSearch}
                  selected={partId}
                  onSelect={(id) => {
                    if (inputValid()) setPartId(id);
                  }}
                />
                {part && (
                  <div key={part.id} className="diy-part-fields">
                    <label>
                      <input
                        type="checkbox"
                        checked={!!part.edit_locked}
                        onChange={(e) =>
                          patchPart("edit_locked", e.target.checked)
                        }
                      />
                      锁定部件
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!part.edit_hidden}
                        onChange={(e) =>
                          patchPart("edit_hidden", e.target.checked)
                        }
                      />
                      编辑时隐藏（导出保留）
                    </label>
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
                      分组路径
                      <input
                        aria-label="部件分组路径"
                        maxLength={120}
                        placeholder="例如：椅子/支撑"
                        value={part.edit_group || ""}
                        onChange={(e) =>
                          patchPart("edit_group", e.target.value)
                        }
                      />
                    </label>
                    {part.edit_group && (
                      <GroupTransform
                        design={design}
                        group={part.edit_group}
                        onCommit={commit}
                        onError={setError}
                      />
                    )}
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
                    <div className="diy-materials">
                      <button
                        disabled={part.edit_locked}
                        onClick={() =>
                          commit((d) => {
                            const p = d.parts.find((p) => p.id === partId);
                            p.x = -p.x;
                            p.rotation = -p.rotation;
                            return d;
                          })
                        }
                      >
                        左右镜像
                      </button>
                      <button
                        disabled={part.edit_locked || design.parts.length > 46}
                        onClick={() =>
                          commit((d) => {
                            const p = d.parts.find((p) => p.id === partId);
                            for (let i = 1; i <= 2; i++)
                              d.parts.push({
                                ...p,
                                id: crypto.randomUUID(),
                                name: `${p.name} ${i + 1}`,
                                x: p.x + (p.width + 0.03) * i,
                              });
                            return d;
                          })
                        }
                      >
                        横向阵列 ×3
                      </button>
                    </div>
                    <p>材质预设（颜色与质感）</p>
                    <div className="diy-materials" aria-label="部件材质预设">
                      {materialPresets.map(({ name, ...material }) => (
                        <button
                          key={name}
                          title={name}
                          disabled={part.edit_locked}
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
                        disabled={part.edit_locked || design.parts.length <= 1}
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
              : unsaved
                ? "有未保存的修改"
                : asset?.status === "ready"
                  ? `${asset.request?.prompt ? "AI 结果已自动保存到素材库" : "已保存到素材库"} · 版本 ${asset.revision}`
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
            disabled={busy || generating || !design || !!issues.length}
            onClick={() => save()}
            title={
              busy
                ? "正在处理，请稍候"
                : generating
                  ? "AI 生成完成后会自动保存"
                  : !design
                    ? "请先生成或创建素材"
                    : issues[0] ||
                      (unsaved
                        ? "保存当前修改到素材库"
                        : "当前内容已保存；修改属性后可再次保存")
            }
          >
            <Save size={14} />
            {busy
              ? "正在处理…"
              : unsaved
                ? "保存修改"
                : asset?.status === "ready"
                  ? "已保存"
                  : "保存素材"}
          </button>
          {onUse && (
            <button
              className="primary-button"
              disabled={busy || generating || !design || !!issues.length}
              onClick={() => {
                if (inputValid())
                  act(async () => {
                    const current = copy(designRef.current);
                    if (
                      saveBeforeUse &&
                      (JSON.stringify(current) !== baseline ||
                        asset?.status !== "ready")
                    ) {
                      const saved = await api(
                        asset?.status === "ready"
                          ? `/diy/assets/${asset.id}/save`
                          : "/diy/assets",
                        json({
                          design: current,
                          revision: asset?.revision || 0,
                        }),
                      );
                      loadValue(saved);
                      await refresh();
                    }
                    await onUse(current, { preserveSize });
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
