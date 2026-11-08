import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  Download,
  ImagePlus,
  Images,
  LoaderCircle,
  PlugZap,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api } from "../api.js";
import InteriorImageGallery from "./InteriorImageGallery.jsx";
import "./interiorImageWorkspace.css";

const maxPromptLength = 1200;
const examplePrompt =
  "保留现有镜头、门窗与家具位置。用柔和的午后自然光表现浅色木纹和布艺，呈现温暖、自然的室内摄影质感。";
const steps = [
  { title: "取景", detail: "在三维里调整镜头，点「用此视角出图」。" },
  { title: "写描述", detail: "说说你想要的光线、材质和氛围。" },
  { title: "对照下载", detail: "比较底图和成图，保存为 PNG。" },
];
const unavailableCopy = {
  deepseek: {
    title: "DeepSeek API 暂未接入效果图生成",
    detail: "后续可能支持。现在要出图，可前往 AI 接入切换并保存 Codex。",
  },
  unavailable: {
    title: "本机 Codex 暂不可用",
    detail: "前往 AI 接入检查 Codex 连接，设置好后再回来生成。",
  },
  offline: {
    title: "本机工作台暂未连接",
    detail: "工作台连接恢复后，可继续使用这里的截图和描述。",
  },
  checking: { title: "正在检查 AI 接入状态" },
};

export default function InteriorImageWorkspace({
  active,
  reference,
  health,
  offline,
  onChooseView,
  onConnections,
  onRetryConnection,
}) {
  const [draft, setDraft] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [sending, setSending] = useState(null);
  const [failure, setFailure] = useState(null);
  const [panel, setPanel] = useState(null);
  const [history, setHistory] = useState({
    items: [],
    folder: "",
    loading: true,
    error: "",
  });
  const [revision, setRevision] = useState(0);
  const heading = useRef(null);
  const request = useRef(null);
  const prompt =
    draft?.projectId === reference?.projectId ? draft?.text || "" : "";
  const current =
    submission?.reference === reference
      ? history.items.find((item) => item.id === submission?.id)
      : null;
  const imageUrl = current?.image_url;
  const error =
    (failure?.reference === reference ? failure?.message : "") ||
    current?.error;
  const pending =
    !!reference && (sending === reference || current?.status === "generating");
  const busy =
    !!sending || history.items.some((item) => item.status === "generating");
  const savedCount = history.items.filter(
    (item) => item.status === "ready",
  ).length;
  const visiblePanel =
    panel || (!reference && history.items.length ? "gallery" : "compose");
  const access =
    health?.ai?.provider === "deepseek"
      ? "deepseek"
      : health?.ai?.provider === "codex" && health.codex?.available
        ? "codex"
        : offline
          ? "offline"
          : health
            ? "unavailable"
            : "checking";
  const ready = access === "codex";
  const unavailable = unavailableCopy[access];
  const currentStep = imageUrl ? 2 : reference ? 1 : 0;

  useEffect(() => {
    if (active) heading.current?.focus({ preventScroll: true });
  }, [active]);

  useEffect(() => {
    if (reference) setPanel("compose");
  }, [reference]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer;
    let polling = false;
    async function loadHistory() {
      try {
        const value = await api("/interior-images", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (controller.signal.aborted) return;
        polling = value.items.some((item) => item.status === "generating");
        setHistory({ ...value, loading: false, error: "" });
      } catch {
        if (controller.signal.aborted) return;
        setHistory((previous) => ({
          ...previous,
          loading: false,
          error: "暂时无法读取本机效果图，请稍后重试。",
        }));
      }
      if (polling) timer = setTimeout(loadHistory, 2000);
    }
    void loadHistory();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, revision]);

  useEffect(() => () => request.current?.abort(), []);

  async function generate(event) {
    event.preventDefault();
    if (!ready || !reference || busy || request.current || !prompt.trim())
      return;
    const controller = new AbortController();
    request.current = controller;
    setSending(reference);
    setFailure(null);
    try {
      const source = await fetch(reference.image, {
        signal: controller.signal,
      });
      const form = new FormData();
      form.set("prompt", prompt.trim());
      form.set("view", await source.blob(), "view.jpg");
      const record = await api("/interior-image", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setSubmission({ reference, id: record.id });
      setHistory((previous) => ({
        ...previous,
        items: [
          record,
          ...previous.items.filter((item) => item.id !== record.id),
        ],
      }));
    } catch (error) {
      if (!controller.signal.aborted)
        setFailure({ reference, message: error.message });
    } finally {
      request.current = null;
      if (!controller.signal.aborted) {
        setSending(null);
        setRevision((value) => value + 1);
      }
    }
  }

  return (
    <section
      className="interior-image-page"
      aria-labelledby="effects-title"
      hidden={!active}
    >
      <header className="interior-image-heading">
        <div className="interior-image-title">
          <span className="interior-image-symbol">
            <ImagePlus size={22} aria-hidden="true" />
          </span>
          <div>
            <h1 id="effects-title" ref={heading} tabIndex={-1}>
              室内效果图
            </h1>
            <p>用自己的三维镜头，预览不同光线和材质下的家。</p>
          </div>
        </div>
        <div className="interior-image-actions">
          {ready && (
            <span className="interior-image-provider">
              <i aria-hidden="true" /> Codex · ImageGen
            </span>
          )}
          {reference && visiblePanel === "compose" && (
            <button
              type="button"
              className="secondary-button"
              onClick={onChooseView}
            >
              <Camera size={15} /> 重新取景
            </button>
          )}
        </div>
      </header>
      <nav className="interior-image-nav" aria-label="效果图工作区视图">
        <button
          type="button"
          aria-current={visiblePanel === "compose" ? "page" : undefined}
          onClick={() => setPanel("compose")}
        >
          <Sparkles size={16} /> 创作
        </button>
        <button
          type="button"
          aria-current={visiblePanel === "gallery" ? "page" : undefined}
          onClick={() => {
            setPanel("gallery");
            setRevision((value) => value + 1);
          }}
        >
          <Images size={16} /> 已生成 <span>{savedCount}</span>
          {busy && <small>生成中</small>}
        </button>
      </nav>
      {visiblePanel === "gallery" ? (
        <InteriorImageGallery
          items={history.items}
          folder={history.folder}
          loading={history.loading}
          error={history.error}
          onRetry={() => setRevision((value) => value + 1)}
          onCompose={() => setPanel("compose")}
        />
      ) : (
        <>
          {unavailable && (
            <section
              className="interior-image-access"
              aria-label="生图接入状态"
              data-access={access}
            >
              {access === "checking" ? (
                <LoaderCircle size={19} aria-hidden="true" />
              ) : (
                <PlugZap size={19} aria-hidden="true" />
              )}
              <div role="status">
                <strong>{unavailable.title}</strong>
                {unavailable.detail && <p>{unavailable.detail}</p>}
              </div>
              {access !== "checking" && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={
                    access === "offline" ? onRetryConnection : onConnections
                  }
                >
                  {access === "offline" ? "重新检查" : "前往 AI 接入"}
                  <ArrowRight size={14} />
                </button>
              )}
            </section>
          )}
          <ol className="interior-image-steps" aria-label="效果图制作步骤">
            {steps.map(({ title, detail }, index) => (
              <li
                key={title}
                aria-current={index === currentStep ? "step" : undefined}
                data-complete={index < currentStep}
              >
                <span className="interior-step-number" aria-hidden="true">
                  {index < currentStep ? <Check size={15} /> : `0${index + 1}`}
                </span>
                <div>
                  <strong>{title}</strong>
                  <p>{detail}</p>
                </div>
              </li>
            ))}
          </ol>
          {!reference ? (
            <div className="interior-image-empty">
              <div className="interior-image-empty-copy">
                <span className="interior-image-eyebrow">
                  第一步 · 三维取景
                </span>
                <h2>先选一个想看的视角</h2>
                <p>
                  在三维预览中旋转模型，或进「看看我家」走到窗边、沙发旁，转向你想看的区域。
                </p>
                <button
                  type="button"
                  className={ready ? "primary-button" : "secondary-button"}
                  onClick={onChooseView}
                >
                  <Camera size={15} /> 去三维取景 <ArrowRight size={14} />
                </button>
              </div>
              <div className="interior-image-frame" aria-hidden="true">
                <ScanLine size={37} strokeWidth={1.3} />
                <span>取景后，三维底图会显示在这里</span>
              </div>
            </div>
          ) : (
            <div className="interior-image-content">
              <div
                className={`interior-image-comparison${imageUrl ? " has-result" : ""}`}
              >
                <figure>
                  <figcaption>
                    三维底图{" "}
                    <span className="interior-image-lock">已锁定视角</span>
                    <small>
                      {[reference.title, reference.roomName]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </figcaption>
                  <img src={reference.image} alt="即将发送的三维视角截图" />
                </figure>
                {imageUrl && (
                  <figure>
                    <figcaption>AI 效果图</figcaption>
                    <img src={imageUrl} alt="AI 生成的室内效果图" />
                  </figure>
                )}
              </div>
              <form
                className="interior-image-form"
                onSubmit={generate}
                aria-busy={busy}
              >
                <div className="interior-image-form-heading">
                  <h2>出图描述</h2>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setDraft({
                        projectId: reference.projectId,
                        text: examplePrompt,
                      })
                    }
                    disabled={!!prompt.trim() || pending}
                  >
                    填入示例
                  </button>
                </div>
                <label htmlFor="interior-image-prompt">
                  描述想看到的光线、材质和氛围
                </label>
                <textarea
                  id="interior-image-prompt"
                  value={prompt}
                  onChange={(event) =>
                    setDraft({
                      projectId: reference.projectId,
                      text: event.target.value,
                    })
                  }
                  placeholder="例如，保留家具布局，做成有下午自然光的暖色原木风，呈现布艺和木纹的真实质感。"
                  maxLength={maxPromptLength}
                  rows={4}
                  required
                  disabled={pending}
                />
                <small className="interior-image-length">
                  {prompt.length} / {maxPromptLength}
                </small>
                <div className="interior-image-privacy">
                  <ShieldCheck size={16} aria-hidden="true" />
                  <p className="field-note">
                    确认生成后，本机 Codex 只把这张截图和描述发给 OpenAI
                    ImageGen。户型原图、GLB 和任务记录留在本机。
                  </p>
                </div>
                {error && (
                  <p role="alert" className="field-note">
                    {error}
                  </p>
                )}
                {busy && (
                  <p role="status" className="interior-image-progress">
                    <LoaderCircle size={16} aria-hidden="true" />
                    {pending
                      ? "正在生成。可以离开页面，进度和结果会保存在「已生成」。"
                      : "已有一张效果图在生成，可以到「已生成」查看。"}
                  </p>
                )}
                <div className="interior-image-actions">
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={!ready || busy || !prompt.trim()}
                  >
                    <Sparkles size={15} />{" "}
                    {busy ? "生成中" : ready ? "生成效果图" : "暂不可生成"}
                  </button>
                  {imageUrl && (
                    <a
                      className="secondary-button"
                      href={imageUrl}
                      download="LayoutSculpt-室内效果图.png"
                    >
                      <Download size={15} /> 下载 PNG
                    </a>
                  )}
                </div>
                {imageUrl && (
                  <p className="interior-image-saved" role="status">
                    <Check size={15} /> 已自动保存到「已生成」
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setPanel("gallery")}
                    >
                      查看图库
                    </button>
                  </p>
                )}
              </form>
            </div>
          )}
        </>
      )}
    </section>
  );
}
