import { useEffect, useRef, useState } from "react";
import {
  UploadCloud,
  ArrowRight,
  LoaderCircle,
  ScanLine,
  ShieldCheck,
  Armchair,
  Box,
  ImagePlus,
} from "lucide-react";
import { useModels } from "../hooks/useModels.js";
import ImagePreparation from "./ImagePreparation.jsx";
import { materials, materialCategories } from "../catalog.js";
import { useCustomTextures } from "../materials/customTextures.js";
import MaterialSample from "./MaterialSample.jsx";
import ModelFields from "./ModelFields.jsx";
import OperationStatus from "./OperationStatus.jsx";
import {
  readGenerationDraft,
  saveGenerationDraft,
  clearGenerationDraft,
} from "../hooks/generationDraft.js";

export default function GenerationForm({ projects, onCancel, onCreated }) {
  const textureStatus = useCustomTextures();
  const [finishes, setFinishes] = useState({ walls: "", floor: "" });
  const models = useModels();
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
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftError, setDraftError] = useState("");
  useEffect(() => {
    let live = true;
    readGenerationDraft()
      .then((value) => {
        if (live && value?.version === 1) setRecovery(value);
      })
      .catch(() => {
        if (live) setDraftError("浏览器草稿存储不可用，请在离开前提交任务。");
      })
      .finally(() => {
        if (live) setDraftLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (
      !draftLoaded ||
      recovery ||
      !(file || name || notes || styleDescription)
    )
      return;
    const persist = () => {
      clearTimeout(draftTimer.current);
      if (submitted.current) return;
      saveGenerationDraft({
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
      })
        .then(() => setDraftError(""))
        .catch(() => setDraftError("生成草稿未能保存到浏览器，请勿关闭页面。"));
    };
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
    recovery,
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
  const styleUnsupported =
    style === "custom" &&
    projects.health &&
    !projects.health.capabilities?.includes("custom_style");
  useEffect(() => {
    if (!file) return;
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
      onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="new-task-page">
      {recovery && (
        <div className="creation-note" role="status">
          <span>发现上次未提交的户型生成草稿。</span>
          <button
            type="button"
            onClick={() => {
              setFile(recovery.file || null);
              setName(recovery.name || "");
              setStyle(recovery.style || "natural");
              setStyleDescription(recovery.styleDescription || "");
              setNotes(recovery.notes || "");
              setFinishes(recovery.finishes || { walls: "", floor: "" });
              setManualReview(Boolean(recovery.manualReview));
              setCollaboration(recovery.collaboration ?? true);
              setFurnitureMode(recovery.furnitureMode || "library");
              setRecovery(null);
            }}
          >
            恢复草稿
          </button>
          <button
            type="button"
            onClick={() => {
              clearGenerationDraft()
                .then(() => setRecovery(null))
                .catch(() => setDraftError("清理草稿失败，请重试"));
            }}
          >
            放弃旧草稿
          </button>
        </div>
      )}
      {draftError && <p role="alert">{draftError}</p>}
      <header className="page-heading">
        <div>
          <span className="eyebrow">开启一个新的空间</span>
          <h1>把户型图，变成你的设计。</h1>
          <p>上传户型图，查看三维空间，再按你的想法调整设计。</p>
          <input
            type="file"
            accept=".zip"
            hidden
            ref={backupPicker}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setBusy(true);
              setError("");
              try {
                const form = new FormData();
                form.append("file", f);
                await projects.importProject(form);
                onCreated();
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          />
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => backupPicker.current.click()}
          >
            从成果 ZIP 恢复为新项目
          </button>
        </div>
        <span className="heading-icon">
          <ImagePlus size={30} strokeWidth={1.3} />
        </span>
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
        <fieldset disabled={busy} className="generation-fields">
          <section className="upload-card">
            <div className="section-heading">
              <h2>
                <span>01</span>上传户型图
              </h2>
              <span>原始素材</span>
            </div>
            <button
              type="button"
              className={`upload-drop ${file ? "has-image" : ""}`}
              onClick={() => picker.current.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
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
                  <span className="upload-symbol">
                    <UploadCloud size={34} strokeWidth={1.3} />
                  </span>
                  <b>将户型图拖入这里</b>
                  <span>或点击选择本地文件</span>
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
              onChange={(e) => choose(e.target.files[0])}
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
            {file && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPreparing(true)}
              >
                裁剪、旋转与纠偏
              </button>
            )}
            <div className="field">
              <label htmlFor="task-name">
                任务名称 <small>便于区分每次设计</small>
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
                <b>每次生成，一个独立工作区</b>
                <p>
                  原图、参数、进度与成果分别保存。可以同时提交多个任务，完成后随时切换查看。
                </p>
              </div>
            </div>
          </section>
          <section className="generation-options">
            <div className="section-heading">
              <h2>
                <span>02</span>定义你的方案
              </h2>
              <span>生成设置</span>
            </div>
            <div
              className="model-capability"
              data-ready={models.ready}
              role="status"
            >
              <span>
                {models.loading
                  ? "正在检测识图模型…"
                  : models.ready
                    ? `${models.selected?.name} · ${models.selected?.supports_image === true ? "支持识图" : "识图能力待确认"}`
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
                选择模型
              </button>
            </div>
            <OperationStatus
              active={busy}
              label="正在上传户型并创建任务"
              detail="提交成功后会进入任务页，请勿重复提交。"
            />
            <div className="field">
              <label>空间风格</label>
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
                    <span className="style-palette">
                      <i />
                      <i />
                      <i />
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
              <h3>墙面与地板选材</h3>
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
                      setFinishes((v) => ({ ...v, [category]: e.target.value }))
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
          <div className="pipeline-preview">
            {[
              [ScanLine, "识别结构"],
              [ShieldCheck, "核对结构"],
              [Armchair, "家具规划"],
              [Box, "三维建模"],
            ]
              .filter(([, label]) => collaboration || label !== "核对结构")
              .map(([Icon, label]) => (
                <span key={label}>
                  <Icon size={15} />
                  {label}
                </span>
              ))}
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
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <ArrowRight size={15} />
              )}
              {busy ? "正在创建任务" : "创建并开始生成"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
