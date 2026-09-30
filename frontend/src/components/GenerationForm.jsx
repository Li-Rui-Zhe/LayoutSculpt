import { useEffect, useRef, useState } from "react";
import {
  UploadCloud,
  ArrowRight,
  RotateCcw,
  LoaderCircle,
  ScanLine,
  ShieldCheck,
  Armchair,
  Box,
  ImagePlus,
} from "lucide-react";
import { useModels, effortLabel } from "../hooks/useModels.js";

export default function GenerationForm({ projects, onCancel, onCreated }) {
  const models = useModels();
  const picker = useRef(null);
  const [file, setFile] = useState(null);
  const [image, setImage] = useState("");
  const [name, setName] = useState("");
  const [style, setStyle] = useState("natural");
  const [notes, setNotes] = useState("");
  const [collaboration, setCollaboration] = useState(true);
  const [furnitureMode, setFurnitureMode] = useState("library");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    if (!name) setName(value.name.replace(/\.[^.]+$/, ""));
    setError("");
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!file || !models.ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      for (const [key, value] of Object.entries({
        file,
        name,
        style,
        notes,
        collaboration: String(collaboration),
        model: models.model,
        reasoning_effort: models.effort,
        furniture_mode: furnitureMode,
      }))
        form.append(key, value);
      await projects.create(form);
      onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="new-task-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">开启一个新的空间</span>
          <h1>把户型图，变成你的设计。</h1>
          <p>上传原图、定义风格，其余交给设计工厂。</p>
        </div>
        <span className="heading-icon">
          <ImagePlus size={30} strokeWidth={1.3} />
        </span>
      </header>
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
            <div className="field">
              <div className="field-heading">
                <label htmlFor="project-model">生成模型</label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => models.refresh(true)}
                  disabled={models.loading}
                >
                  <RotateCcw
                    size={12}
                    className={models.loading ? "spin" : ""}
                  />
                  刷新模型
                </button>
              </div>
              <select
                id="project-model"
                value={models.model}
                onChange={(e) => models.select(e.target.value)}
                disabled={models.loading || !models.catalog}
              >
                {!models.selected && (
                  <option value={models.model}>
                    {models.loading ? "正在读取模型…" : "请选择可用模型"}
                  </option>
                )}
                {models.catalog?.items.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={item.supports_image === false}
                  >
                    {item.name}
                    {item.id === models.catalog.default_model
                      ? " · 本地默认"
                      : ""}
                    {item.supports_image === false ? " · 不支持图片" : ""}
                  </option>
                ))}
              </select>
              {models.error && <p className="field-error">{models.error}</p>}
            </div>
            <div className="field">
              <label htmlFor="project-effort">推理强度</label>
              <select
                id="project-effort"
                value={models.effort}
                disabled={!models.ready || !models.efforts.length}
                onChange={(e) => models.selectEffort(e.target.value)}
              >
                {!models.effort && <option value="">使用本地默认</option>}
                {models.efforts.map((value) => (
                  <option key={value} value={value}>
                    {effortLabel(value)} · {value}
                    {value === models.selected?.default_effort
                      ? "（模型默认）"
                      : ""}
                  </option>
                ))}
              </select>
              <small className="field-note">
                {models.efforts.length
                  ? "应用于识别、复核和规划；强度越高，通常耗时越长。"
                  : "当前模型未提供可选档位，使用本地默认设置。"}
              </small>
            </div>
            <div className="field">
              <label>空间风格</label>
              <div className="style-options">
                {[
                  ["natural", "自然原木", "温润 · 松弛"],
                  ["cream", "奶油简约", "柔和 · 纯净"],
                  ["modern", "现代雅致", "克制 · 利落"],
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
            </div>
            <div className="field">
              <label htmlFor="furniture-mode">家具方案</label>
              <select
                id="furniture-mode"
                value={furnitureMode}
                onChange={(e) => setFurnitureMode(e.target.value)}
              >
                <option value="library">精细家具 · 实木、织物与软包细节</option>
                <option value="basic">基础几何 · 快速查看空间布局</option>
              </select>
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
                placeholder="例如：保留原户型，次卧改为书房，客厅使用三人沙发。"
              />
            </div>
            <label className="review-option">
              <input
                type="checkbox"
                checked={collaboration}
                onChange={(e) => setCollaboration(e.target.checked)}
              />
              <span>
                <b>独立空间复核</b>
                <small>对照原图检查结构后，再进行家具规划</small>
              </span>
              <ShieldCheck size={18} />
            </label>
          </section>
        </fieldset>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {projects.health && !projects.health.blender.available && (
          <div className="form-error">
            未找到 Blender，请先配置本地建模环境。
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
              [ShieldCheck, "空间复核"],
              [Armchair, "家具规划"],
              [Box, "三维建模"],
            ]
              .filter(([, label]) => collaboration || label !== "空间复核")
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
                !file ||
                !models.ready ||
                !projects.health?.blender.available ||
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
