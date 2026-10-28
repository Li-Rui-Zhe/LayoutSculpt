import { InlineProgress } from "./LoadingProgress.jsx";
import { useEffect, useRef, useState } from "react";
import {
  UploadCloud,
  ArrowRight,
  ShieldCheck,
  Check,
  SlidersHorizontal,
  FolderOpen,
  X,
} from "lucide-react";
import { useModels } from "../hooks/useModels.js";
import ImagePreparation from "./ImagePreparation.jsx";
import FloorplanExamples from "./FloorplanExamples.jsx";
import { materials, materialCategories } from "../catalog.js";
import { useCustomTextures } from "../materials/customTextures.js";
import MaterialSample from "./MaterialSample.jsx";
import ModelFields from "./ModelFields.jsx";
import OperationStatus from "./OperationStatus.jsx";
import { useProgressGate } from "./useProgressGate.js";
import {
  readGenerationDraft,
  saveGenerationDraft,
  clearGenerationDraft,
} from "../hooks/generationDraft.js";

import {
  generationDraftContent,
  hasGenerationDraft,
} from "../hooks/generationDraftContent.js";

export default function GenerationForm({
  projects,
  onCancel,
  onCreated,
  replacementJob,
}) {
  const completion = useProgressGate();
  const textureStatus = useCustomTextures();
  const [finishes, setFinishes] = useState({ walls: "", floor: "" });
  const models = useModels({
    initialModel: replacementJob?.options?.model,
    initialEffort: replacementJob?.options?.effort,
  });
  const modelOptions = useRef(null);
  const picker = useRef(null);
  const backupPicker = useRef(null);
  const submitLock = useRef(false);
  const submitted = useRef(false);
  const draftTimer = useRef(null);
  const [preparing, setPreparing] = useState(false);
  const [file, setFile] = useState(null);
  const [image, setImage] = useState("");
  const [imageInfo, setImageInfo] = useState(null);
  useEffect(() => {
    let live = true;
    setImageInfo(null);
    if (file)
      createImageBitmap(file)
        .then((bitmap) => {
          if (live)
            setImageInfo({ width: bitmap.width, height: bitmap.height });
          bitmap.close();
        })
        .catch(() => {
          if (live) setError("图片无法读取，请选择有效的户型图。");
        });
    return () => {
      live = false;
    };
  }, [file]);
  const [name, setName] = useState("");
  const [style, setStyle] = useState("natural");
  const [styleDescription, setStyleDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [collaboration, setCollaboration] = useState(true);
  const [manualReview, setManualReview] = useState(false);
  const [furnitureMode, setFurnitureMode] = useState("library");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const clearingRef = useRef(false);
  const flushDraft = useRef(null);
  const draftReadable = useRef(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftError, setDraftError] = useState("");
  const applyDraft = (value = {}) => {
    const d = generationDraftContent(value);
    setFile(d.file);
    setName(d.name);
    setStyle(d.style);
    setStyleDescription(d.styleDescription);
    setNotes(d.notes);
    setFinishes(d.finishes);
    setCollaboration(d.collaboration);
    setManualReview(d.manualReview);
    setFurnitureMode(d.furnitureMode);
  };
  const currentDraft = {
    file,
    name,
    style,
    styleDescription,
    notes,
    finishes,
    collaboration,
    manualReview,
    furnitureMode,
  };
  const hasDraft = hasGenerationDraft(currentDraft);
  const clearDraft = async () => {
    if (busy || !draftLoaded || clearingRef.current) return;
    clearingRef.current = true;
    setClearing(true);
    flushDraft.current = null;
    clearTimeout(draftTimer.current);
    try {
      await clearGenerationDraft();
      applyDraft();
      setPreparing(false);
      setError("");
      setDraftError("");
      if (picker.current) picker.current.value = "";
    } catch {
      setDraftError("清空失败，填写内容已保留，请重试。");
    } finally {
      clearingRef.current = false;
      setClearing(false);
    }
  };
  useEffect(() => {
    let live = true;
    readGenerationDraft()
      .then((value) => {
        draftReadable.current = true;
        if (
          live &&
          !replacementJob &&
          value?.version === 1 &&
          hasGenerationDraft(value)
        )
          applyDraft(value);
      })
      .catch(() => {
        if (live) setDraftError("浏览器草稿存储不可用，请在离开前提交任务。");
      })
      .finally(() => {
        if (live && replacementJob) {
          const o = replacementJob.options || {};
          applyDraft({
            name: replacementJob.name,
            style: o.style,
            styleDescription: o.style_description,
            notes: o.notes,
            finishes: { walls: o.wall_material, floor: o.floor_material },
            collaboration: o.collaboration,
            manualReview: o.review_mode === "manual",
            furnitureMode: o.furniture_mode,
          });
        }
        if (live) setDraftLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!draftLoaded || clearing || !draftReadable.current) return;
    const persist = () => {
      clearTimeout(draftTimer.current);
      if (submitted.current || clearingRef.current) return;
      const value = generationDraftContent({
        version: 1,
        file,
        name,
        style,
        styleDescription,
        notes,
        finishes,
        collaboration,
        manualReview,
        furnitureMode,
      });
      return (
        hasGenerationDraft(value)
          ? saveGenerationDraft(value)
          : clearGenerationDraft()
      )
        .then(() => setDraftError(""))
        .catch(() => setDraftError("生成草稿未能保存到浏览器，请勿关闭页面。"));
    };
    flushDraft.current = persist;
    const onHidden = () => {
      if (document.visibilityState === "hidden") persist();
    };
    draftTimer.current = setTimeout(persist, 300);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      clearTimeout(draftTimer.current);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [
    draftLoaded,
    clearing,
    file,
    name,
    style,
    styleDescription,
    notes,
    finishes,
    collaboration,
    manualReview,
    furnitureMode,
  ]);
  useEffect(
    () => () => {
      flushDraft.current?.();
    },
    [],
  );
  const styleUnsupported =
    style === "custom" &&
    projects.health &&
    !projects.health.capabilities?.includes("custom_style");
  useEffect(() => {
    if (!file) {
      setImage("");
      return;
    }
    const url = URL.createObjectURL(file);
    setImage(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const choose = (value) => {
    if (!value) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(value.type)) {
      setError("请选择 PNG、JPG 或 WebP 户型图。");
      return;
    }
    if (value.size > 20 * 1024 * 1024) {
      setError("图片不能超过 20 MB。");
      return;
    }
    setFile(value);
    setName((current) => current || value.name.replace(/\.[^.]+$/, ""));
    setError("");
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!file || !models.ready || busy || submitLock.current) return;
    if (styleUnsupported) {
      setError(
        "当前后端尚未更新，请重启本项目服务后再使用自定义风格；填写内容已保留。",
      );
      return;
    }
    if (style === "custom" && !styleDescription.trim()) {
      setError("请填写自定义空间风格。");
      return;
    }
    submitLock.current = true;
    completion.reset();
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      for (const [key, value] of Object.entries({
        file,
        name,
        style,
        style_description: style === "custom" ? styleDescription.trim() : "",
        notes,
        collaboration: String(collaboration),
        review_mode: manualReview ? "manual" : "preview",
        model: models.model,
        reasoning_effort: models.effort,
        furniture_mode: furnitureMode,
        wall_material: finishes.walls,
        floor_material: finishes.floor,
      }))
        form.append(key, value);
      await projects.create(form);
      submitted.current = true;
      clearTimeout(draftTimer.current);
      await clearGenerationDraft().catch(() => {});
      if (await completion.finish()) onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };
  const blockedReason = !file
    ? "先上传一张户型图，也可以使用示例体验"
    : models.loading
      ? "正在检查 AI 接入，请稍候"
      : !models.ready
        ? "请在高级设置中选择可用的识图模型"
        : styleUnsupported
          ? "当前服务暂不支持自定义风格，请更新服务"
          : style === "custom" && !styleDescription.trim()
            ? "描述一下你想要的空间风格"
            : furnitureMode === "library" &&
                !projects.health?.furniture_library?.available
              ? "精细家具库尚未就绪，请检查服务或在高级设置中更换方案"
              : "准备就绪，生成后可继续调整设计";
  return (
    <div className="new-task-page">
      {draftError && <p role="alert">{draftError}</p>}
      <header className="page-heading">
        <div>
          <h1>
            新建设计<span>让家的想法，变成看得见的空间</span>
          </h1>
          <p>上传户型图，AI 为你搭建三维空间，之后可以自由调整。</p>
        </div>
        <div className="creation-import">
          <button
            type="button"
            className="secondary-button"
            disabled={busy || clearing || !draftLoaded || !hasDraft}
            onClick={clearDraft}
          >
            {clearing ? "正在清空…" : "清空重填"}
          </button>
          <input
            type="file"
            accept=".zip"
            hidden
            ref={backupPicker}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (submitLock.current) return;
              submitLock.current = true;
              completion.reset();
              setImporting(true);
              setBusy(true);
              setError("");
              try {
                const form = new FormData();
                form.append("file", f);
                await projects.importProject(form);
                if (await completion.finish()) onCreated();
              } catch (e) {
                setError(e.message);
              } finally {
                submitLock.current = false;
                setImporting(false);
                setBusy(false);
              }
            }}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => backupPicker.current.click()}
          >
            <FolderOpen size={16} /> 导入项目 ZIP
          </button>
        </div>
      </header>
      {preparing && file && (
        <ImagePreparation
          file={file}
          onClose={() => setPreparing(false)}
          onApply={(value) => {
            choose(value);
            setPreparing(false);
          }}
        />
      )}
      <form onSubmit={submit}>
        <fieldset
          disabled={busy || clearing || !draftLoaded}
          className="generation-fields"
        >
          <section className="upload-card">
            <div className="section-heading">
              <h2>
                <span>01</span>上传户型图
              </h2>
              {file && (
                <span className="creation-tag">
                  <Check size={14} /> 已选择
                </span>
              )}
            </div>
            <button
              type="button"
              className={`upload-drop ${file ? "has-image" : ""} ${dragging ? "is-dragging" : ""}`}
              onClick={() => picker.current.click()}
              onDragOver={(e) => {
                e.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!busy) choose(e.dataTransfer.files[0]);
              }}
            >
              {image ? (
                <>
                  <img src={image} alt="待上传的户型图" />
                  <span className="replace-image">点击更换户型图</span>
                </>
              ) : (
                <>
                  <svg
                    className="upload-plan-art"
                    viewBox="0 0 240 140"
                    fill="none"
                    aria-hidden="true"
                  >
                    <rect
                      x="37"
                      y="9"
                      width="166"
                      height="122"
                      rx="5"
                      fill="white"
                      stroke="#d9e2db"
                    />
                    <path
                      d="M57 28H183V112H57V28Z"
                      fill="#f2f5ef"
                      stroke="#5e786a"
                      strokeWidth="3"
                    />
                    <path
                      d="M132 28V66M132 86V112M132 72H183M57 79H84M106 79H132"
                      stroke="#5e786a"
                      strokeWidth="3"
                    />
                    <path
                      d="M132 86Q112 86 112 66H132M84 79V101Q106 101 106 79"
                      stroke="#97ad9c"
                    />
                    <rect
                      x="143"
                      y="38"
                      width="29"
                      height="24"
                      rx="2"
                      fill="#e2d8c3"
                      stroke="#c5b998"
                    />
                    <rect
                      x="146"
                      y="41"
                      width="10"
                      height="6"
                      rx="1"
                      fill="white"
                    />
                    <rect
                      x="159"
                      y="41"
                      width="10"
                      height="6"
                      rx="1"
                      fill="white"
                    />
                    <rect
                      x="68"
                      y="39"
                      width="37"
                      height="13"
                      rx="3"
                      fill="#c9d6c5"
                    />
                    <rect
                      x="78"
                      y="59"
                      width="20"
                      height="9"
                      rx="4"
                      fill="#dfd2b9"
                    />
                    <path
                      d="M67 28H100M148 112H172"
                      stroke="#a9c9d0"
                      strokeWidth="3"
                    />
                    <path
                      d="M57 17H183M57 14V20M183 14V20M215 28V112M212 28H218M212 112H218"
                      stroke="#b6c7b9"
                    />
                  </svg>
                  <b>把户型图放在这里</b>
                  <span>拖入图片，或点击下方上传</span>
                  <span className="upload-select">
                    <UploadCloud size={17} /> 选择户型图
                  </span>
                  <small>PNG、JPG、WebP · 最大 20 MB</small>
                </>
              )}
            </button>
            {imageInfo && (
              <p className="field-note" role="status">
                原图 {imageInfo.width} × {imageInfo.height} 像素
                {Math.min(imageInfo.width, imageInfo.height) < 800
                  ? " · 分辨率偏低，建议上传更清晰的原图，重点核对识别后的门窗和尺寸。"
                  : " · 请确认尺寸文字可辨认、户型边界完整。"}
              </p>
            )}
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="选择户型图"
              hidden
              onChange={(e) => {
                choose(e.target.files[0]);
                e.target.value = "";
              }}
            />
            <div className="file-caption">
              <span>
                {file
                  ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`
                  : "清晰的尺寸标注，让结构识别更准确"}
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const response = await fetch("/sample-floorplan.png");
                    if (!response.ok) throw new Error("示例图片不可用");
                    choose(
                      new File([await response.blob()], "示例户型.png", {
                        type: "image/png",
                      }),
                    );
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                使用示例户型 ↗
              </button>
            </div>
            {replacementJob && !file && (
              <p className="field-note" role="status">
                设计偏好已带入，请选择新的户型图。原任务和原图仍保留。
              </p>
            )}
            <FloorplanExamples />
            {file && (
              <div className="upload-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setPreparing(true)}
                >
                  裁剪、旋转与纠偏
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setFile(null);
                    setError("");
                  }}
                >
                  <X size={14} /> 移除图片
                </button>
              </div>
            )}
            <div className="field">
              <label htmlFor="task-name">
                任务名称 <small>可稍后修改</small>
              </label>
              <input
                id="task-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder="例如：望江公寓 · 原木方案"
              />
            </div>
            <div className="creation-note">
              <ShieldCheck size={18} />
              <div>
                <p>每份设计独立保存，随时回来继续。</p>
              </div>
            </div>
          </section>
          <section className="generation-options">
            <div className="section-heading">
              <h2>
                <span>02</span>设计偏好
              </h2>
              <span className="creation-tag">已有默认方案</span>
            </div>
            <OperationStatus
              active={busy && !completion.completed}
              onIdle={completion.onIdle}
              failed={!!error}
              successLabel="任务已提交"
              label={importing ? "正在导入项目" : "正在上传户型并创建任务"}
              detail="提交成功后会进入任务页，请勿重复提交。"
            />
            <div className="field">
              <label>
                空间风格 <small>材质搭配参考</small>
              </label>
              <div className="style-options">
                {[
                  ["natural", "自然原木", "温润 · 松弛"],
                  ["cream", "奶油简约", "柔和 · 纯净"],
                  ["modern", "现代雅致", "克制 · 利落"],
                  ["custom", "自定义风格", "按你的想法设计"],
                ].map(([id, title, desc]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={style === id}
                    className={`style-choice ${id} ${style === id ? "selected" : ""}`}
                    onClick={() => setStyle(id)}
                  >
                    {id !== "custom" && (
                      <span className="style-board" aria-hidden="true">
                        <img
                          className="board-wood"
                          src={`/materials/${id}_wood_color.png`}
                          alt=""
                        />
                        <img
                          className="board-fabric"
                          src={`/materials/${id}_fabric_color.png`}
                          alt=""
                        />
                        <img
                          className="board-stone"
                          src={`/materials/${id}_stone_color.png`}
                          alt=""
                        />
                      </span>
                    )}
                    {id === "custom" && (
                      <SlidersHorizontal
                        className="style-custom-icon"
                        size={22}
                        aria-hidden="true"
                      />
                    )}
                    <span className="style-selected" aria-hidden="true">
                      {style === id && <Check size={12} />}
                    </span>
                    <b>{title}</b>
                    <small>{desc}</small>
                  </button>
                ))}
              </div>
              {style === "custom" && (
                <div className="custom-style-field">
                  <label htmlFor="custom-space-style">描述你的空间风格</label>
                  <textarea
                    id="custom-space-style"
                    required
                    maxLength={1000}
                    value={styleDescription}
                    onChange={(e) => setStyleDescription(e.target.value)}
                    placeholder="例如：中古风，胡桃木搭配米白墙面，深绿色点缀，家具线条简洁，避免大面积亮面金属。"
                    aria-describedby="custom-style-help"
                  />
                  <div className="custom-style-examples">
                    {[
                      "中古风，胡桃木与米白，深绿色点缀",
                      "侘寂风，微水泥、浅木色，低矮家具",
                      "现代工业风，灰色墙面、深木地板、黑色金属",
                    ].map((text) => (
                      <button
                        key={text}
                        type="button"
                        onClick={() => setStyleDescription(text)}
                      >
                        {text.split("，")[0]}
                      </button>
                    ))}
                  </div>
                  <p className="field-note" id="custom-style-help">
                    用于家具选型与墙地面搭配；下方手动选择的材质优先。
                    {styleDescription.length}/1000
                  </p>
                  <p className="field-note">
                    将从现有素材中搭配接近的效果；特定家具或纹理可先在 DIY
                    中制作。
                  </p>
                  {styleUnsupported && (
                    <p role="alert">
                      当前后端尚未更新，请重启本项目服务后再使用自定义风格。
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="project-notes">
                设计要求 <small>选填</small>
              </label>
              <textarea
                id="project-notes"
                value={notes}
                maxLength={3000}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="例如：保留原图墙体与门窗，客厅使用三人沙发和原木家具。"
              />
            </div>

            <details className="creation-materials">
              <summary>
                <span>墙面与地板</span>
                <small>
                  {finishes.walls || finishes.floor
                    ? "已自选材质"
                    : "按风格自动搭配"}
                </small>
              </summary>
              <div className="field">
                {textureStatus.error && (
                  <p role="alert">
                    自定义材质暂未同步，请在素材库重试。已有选择已保留。
                  </p>
                )}
                <p className="field-note">
                  可选择内置样板或在 DIY
                  页面保存的材质。生成后可按房间、单面墙继续修改。
                </p>
                {[
                  ["walls", "墙面"],
                  ["floor", "地板"],
                ].map(([category, label]) => (
                  <label key={category}>
                    {label}
                    <select
                      aria-label={`生成${label}材质`}
                      value={finishes[category]}
                      onChange={(e) =>
                        setFinishes((v) => ({
                          ...v,
                          [category]: e.target.value,
                        }))
                      }
                    >
                      <option value="">按空间风格自动搭配</option>
                      {materialCategories[category]
                        .map((id) => materials.find((m) => m.id === id))
                        .filter(Boolean)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.recipe ? "DIY · " : ""}
                            {m.name}
                          </option>
                        ))}
                    </select>
                    {finishes[category] && (
                      <MaterialSample
                        material={materials.find(
                          (m) => m.id === finishes[category],
                        )}
                        className="chip"
                      />
                    )}
                  </label>
                ))}
              </div>
            </details>
            <details className="model-advanced" ref={modelOptions}>
              <summary>高级设置 · 默认已配置</summary>
              <ModelFields models={models} />
              <div className="field">
                <label htmlFor="furniture-mode">家具方案</label>
                <select
                  id="furniture-mode"
                  value={furnitureMode}
                  onChange={(e) => setFurnitureMode(e.target.value)}
                >
                  <option value="library">
                    精细家具 · 实木、织物与软包细节
                  </option>
                  <option value="basic">基础几何 · 快速查看空间布局</option>
                </select>
              </div>
              <label className="review-option">
                <input
                  type="checkbox"
                  checked={collaboration}
                  onChange={(e) => setCollaboration(e.target.checked)}
                />
                <span>
                  <b>增加一次 AI 结构复核</b>
                  <small>默认开启，帮助检查识别遗漏；不会代替人工核对</small>
                </span>
                <ShieldCheck size={18} />
              </label>
              <label className="review-option">
                <input
                  type="checkbox"
                  checked={manualReview}
                  onChange={(e) => setManualReview(e.target.checked)}
                />
                <span>
                  <b>先人工核对，再生成三维</b>
                  <small>默认先展示三维初稿；初稿不代表已人工核对。</small>
                </span>
              </label>
            </details>
            <div
              className="model-capability"
              data-ready={models.ready}
              role="status"
            >
              <span>
                {models.loading
                  ? "正在检测识图模型…"
                  : models.ready
                    ? models.selected?.supports_image === true
                      ? "AI 已就绪 · 自动识别户型"
                      : "AI 已连接 · 识图能力待确认"
                    : "当前接入无法识别户型图，请选择可用的识图模型"}
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  modelOptions.current.open = true;
                  modelOptions.current.querySelector("select")?.focus();
                }}
              >
                {models.ready ? "更改" : "设置接入"}
              </button>
            </div>
          </section>
        </fieldset>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {furnitureMode === "library" &&
          projects.health &&
          !projects.health.furniture_library?.available && (
            <div className="form-error">
              家具库尚未就绪，请使用基础几何方案。
            </div>
          )}
        <div className="generation-footer">
          <div className="creation-readiness" role="status">
            <span className="readiness-dot" />
            <span>
              {busy
                ? importing
                  ? "正在导入，请稍候…"
                  : "正在创建，请稍候…"
                : blockedReason}
            </span>
          </div>
          <div>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={onCancel}
            >
              返回工作区
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={
                busy ||
                styleUnsupported ||
                !file ||
                !models.ready ||
                (style === "custom" && !styleDescription.trim()) ||
                (furnitureMode === "library" &&
                  !projects.health?.furniture_library?.available)
              }
            >
              <InlineProgress
                active={busy && !completion.completed}
                failed={!!error}
                fallback={<ArrowRight size={15} />}
              />
              {busy
                ? importing
                  ? "正在导入项目"
                  : "正在创建任务"
                : "创建并开始生成"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
