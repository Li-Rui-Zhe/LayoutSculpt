import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  Download,
  ImagePlus,
  Images,
  PlugZap,
  Sparkles,
  X,
  RefreshCw,
} from "lucide-react";
import { api } from "../api.js";
import { downloadFile } from "../downloadFile.js";
import InteriorImageGallery from "./InteriorImageGallery.jsx";
import { elapsedLabel, pollInteriorHistory } from "./interiorImageState.js";
import "./interiorImageWorkspace.css";

const suggestions = [
  [
    "午后自然光",
    "保留门窗和家具位置。柔和的午后自然光，浅木纹与亚麻布艺，真实自然的居家摄影质感。",
  ],
  [
    "温暖夜晚",
    "保留门窗和家具位置。窗外入夜，室内暖色灯光照亮阅读和休息区域，保留暗部层次，避免过曝。",
  ],
  [
    "清爽明亮",
    "保留门窗和家具位置。明亮而不过曝的日光，干净的浅色墙面、自然木纹，呈现清爽舒适的真实空间。",
  ],
];

export default function InteriorImageWorkspace({
  active,
  reference,
  draft,
  offline,
  onChooseView,
  onConnections,
}) {
  const [history, setHistory] = useState({
    items: [],
    loading: true,
    error: "",
  });
  const [capability, setCapability] = useState(null);
  const [panel, setPanel] = useState("compose");
  const [comparison, setComparison] = useState("result");
  const [revision, setRevision] = useState(0);
  const [sending, setSending] = useState(false);
  const [action, setAction] = useState("");
  const [failure, setFailure] = useState("");
  const [now, setNow] = useState(Date.now());
  const heading = useRef(null),
    request = useRef(null),
    alive = useRef(true);
  const current = history.items.find((item) => item.id === draft.submissionId);
  const running = history.items.find((item) => item.status === "generating");
  const busy = sending || !!running;
  const ready = capability?.available && !offline;
  const imageUrl = current?.image_url;
  const prompt = draft.prompt;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (active) heading.current?.focus({ preventScroll: true });
  }, [active]);
  useEffect(() => {
    if (reference) {
      setPanel("compose");
      setFailure("");
    }
  }, [reference]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const stop = pollInteriorHistory({
      load: () =>
        api("/interior-images", {
          signal: controller.signal,
          cache: "no-store",
        }),
      onData: (value) => setHistory({ ...value, loading: false, error: "" }),
      onError: (error, retrying) =>
        setHistory((previous) => ({
          ...previous,
          loading: false,
          error: `${error.status === 404 ? "服务版本较旧，请重启工作台加载新版接口。" : "暂时无法同步生成记录，已有图片和草稿仍保留。"}${retrying ? " 正在重新连接…" : " 请点击重新同步。"}`,
        })),
    });
    api("/interior-images/capability", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setCapability(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCapability({
            available: false,
            message:
              "未能检查生图环境，请重新同步；若刚更新代码，请重启工作台。",
          });
      });
    return () => {
      stop();
      controller.abort();
    };
  }, [active, revision]);
  useEffect(() => {
    if (!active || !running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, running?.id]);

  async function perform(id, work) {
    if (action || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setAction(id);
    setFailure("");
    try {
      await work(controller.signal);
    } catch (error) {
      if (alive.current) setFailure(error.message);
    } finally {
      request.current = null;
      if (alive.current) {
        setAction("");
        setRevision((v) => v + 1);
      }
    }
  }
  async function generate(event) {
    event.preventDefault();
    if (!ready || !reference || busy || request.current || !prompt.trim())
      return;
    const sourceRef = reference;
    const controller = new AbortController();
    request.current = controller;
    setSending(true);
    setFailure("");
    try {
      const source = await fetch(reference.image, {
        signal: controller.signal,
      });
      if (!source.ok) throw Error("底图暂时无法读取，请重新取景后再试。");
      const form = new FormData();
      form.set("prompt", prompt.trim());
      form.set("view", await source.blob(), "view.jpg");
      form.set(
        "context",
        JSON.stringify({
          projectId: reference.projectId || "",
          title: reference.title || "",
          roomName: reference.roomName || "",
        }),
      );
      const record = await api("/interior-image", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!alive.current) return;
      draft.submitted(sourceRef, record.id);
      setHistory((previous) => ({
        ...previous,
        items: [
          record,
          ...previous.items.filter((item) => item.id !== record.id),
        ],
      }));
      setComparison("result");
    } catch (error) {
      if (alive.current) setFailure(error.message);
    } finally {
      request.current = null;
      if (alive.current) {
        setSending(false);
        setRevision((v) => v + 1);
      }
    }
  }
  function reuse(item) {
    draft.choose(
      {
        image: item.view_url,
        projectId: item.context?.projectId || "",
        title: item.context?.title || "历史取景",
        roomName: item.context?.roomName || "",
      },
      item.prompt,
    );
    setPanel("compose");
    setFailure("");
  }
  const cancel = (item) =>
    perform(item.id, (signal) =>
      api(`/interior-images/${item.id}/cancel`, { method: "POST", signal }),
    );
  const archive = (item) =>
    perform(item.id, (signal) =>
      api(`/interior-images/${item.id}/archive`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !item.archived }),
      }),
    );
  const download = (item) =>
    perform(`download-${item.id}`, (signal) =>
      downloadFile(item.image_url, `造个家-效果图-${item.id.slice(0, 8)}.png`, {
        signal,
      }),
    );

  return (
    <section
      className="interior-image-page"
      aria-labelledby="effects-title"
      hidden={!active}
    >
      <header className="interior-image-heading">
        <div className="interior-image-title">
          <span className="interior-image-symbol">
            <ImagePlus size={23} />
          </span>
          <div>
            <span className="interior-image-eyebrow">从空间，到生活的样子</span>
            <h1 id="effects-title" ref={heading} tabIndex={-1}>
              效果图工作室
            </h1>
            <p>选好镜头，让光线与材质再近一步。</p>
          </div>
        </div>
        <nav className="interior-image-nav" aria-label="效果图工作区视图">
          <button
            aria-current={panel === "compose" ? "page" : undefined}
            onClick={() => setPanel("compose")}
          >
            <Sparkles size={16} />
            创作
          </button>
          <button
            aria-current={panel === "gallery" ? "page" : undefined}
            onClick={() => {
              setPanel("gallery");
              setRevision((v) => v + 1);
            }}
          >
            <Images size={16} />
            我的效果图{" "}
            <span>
              {
                history.items.filter((v) => v.status === "ready" && !v.archived)
                  .length
              }
            </span>
          </button>
        </nav>
      </header>
      {(history.error || failure) && (
        <div className="interior-notice" role="alert">
          <span>{failure || history.error}</span>
          <button
            onClick={() => {
              setFailure("");
              setRevision((v) => v + 1);
            }}
          >
            <RefreshCw size={14} />
            重新同步
          </button>
        </div>
      )}
      {running && (
        <div className="interior-job" role="status">
          <span className="interior-job-pulse" aria-hidden="true" />
          <div>
            <strong>
              正在描绘空间 · {elapsedLabel(running.created_at, now)}
            </strong>
            <small>可以继续浏览，完成后自动保存在「我的效果图」。</small>
          </div>
          <button disabled={!!action} onClick={() => cancel(running)}>
            <X size={14} />
            {action === running.id ? "正在取消…" : "取消生成"}
          </button>
          <div className="interior-job-track" aria-hidden="true">
            <i />
          </div>
        </div>
      )}
      {panel === "gallery" ? (
        <InteriorImageGallery
          {...history}
          onRetry={() => setRevision((v) => v + 1)}
          onCompose={() => setPanel("compose")}
          onReuse={reuse}
          onArchive={archive}
          onDownload={download}
          onCancel={cancel}
          action={action}
          sending={sending}
        />
      ) : (
        <div className="interior-image-content">
          <div className="interior-stage">
            <div className="interior-stage-heading">
              <div>
                <span className="interior-image-eyebrow">
                  {imageUrl ? "02 / 空间效果" : "01 / 当前取景"}
                </span>
                <h2>
                  {reference?.title || "从一个喜欢的角度开始"}
                  {reference?.roomName ? ` · ${reference.roomName}` : ""}
                </h2>
              </div>
              {reference && (
                <button
                  className="secondary-button"
                  disabled={sending}
                  onClick={onChooseView}
                >
                  <Camera size={14} />
                  重新取景
                </button>
              )}
            </div>
            {reference ? (
              <>
                {imageUrl && (
                  <div
                    className="interior-compare-tabs"
                    role="group"
                    aria-label="图片对照方式"
                  >
                    {[
                      ["result", "效果图"],
                      ["source", "三维底图"],
                      ["compare", "并排对照"],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        aria-pressed={comparison === key}
                        onClick={() => setComparison(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <div
                  className={`interior-image-comparison${imageUrl && comparison === "compare" ? " has-result" : ""}`}
                >
                  {(!imageUrl || comparison !== "result") && (
                    <figure>
                      <img src={reference.image} alt="即将发送的三维视角截图" />
                      <figcaption>
                        三维底图 <span>已选定底图</span>
                      </figcaption>
                    </figure>
                  )}
                  {imageUrl && comparison !== "source" && (
                    <figure>
                      <img src={imageUrl} alt="AI 生成的室内效果图" />
                      <figcaption>
                        空间效果 <span>已保存到本机</span>
                      </figcaption>
                    </figure>
                  )}
                </div>
                <p className="interior-stage-note">
                  效果图用于比较光线与氛围，尺寸和布局请以三维方案为准。
                </p>
                {imageUrl && (
                  <button
                    className="secondary-button"
                    disabled={!!action}
                    onClick={() => download(current)}
                  >
                    <Download size={15} />
                    {action ? "正在准备…" : "下载高清图片"}
                  </button>
                )}
              </>
            ) : (
              <div className="interior-image-empty">
                <div className="interior-room-sketch" aria-hidden="true">
                  <div className="sketch-window" />
                  <div className="sketch-sofa" />
                  <div className="sketch-rug" />
                  <Camera size={28} />
                </div>
                <h3>镜头里，就是你设计的家</h3>
                <p>
                  在三维中旋转查看，也可以走进房间。
                  <br />
                  找到喜欢的角度，再带它来这里。
                </p>
                <button
                  className="primary-button"
                  disabled={!draft.loaded}
                  onClick={onChooseView}
                >
                  去三维取景 <ArrowRight size={16} />
                </button>
                <span className="interior-empty-note">
                  取景 → 描述想法 → 预览与下载
                </span>
              </div>
            )}
            <p className="interior-draft-status" role="status">
              {draft.status ||
                (draft.loaded ? "底图与描述仅保存在本机" : "正在恢复上次创作…")}
            </p>
          </div>
          <form
            className="interior-image-form"
            onSubmit={generate}
            aria-busy={sending}
          >
            <div>
              <span className="interior-image-eyebrow">让这个角落，更像家</span>
              <h2>想看到什么感觉？</h2>
              <p>说说光线、材质，或你想改变的氛围。</p>
            </div>
            <label htmlFor="interior-image-prompt">你的想法</label>
            <textarea
              id="interior-image-prompt"
              value={prompt}
              onChange={(event) => draft.update({ prompt: event.target.value })}
              disabled={!reference || sending}
              placeholder="比如：保留现在的布置，阳光落在木地板上，沙发是温暖的亚麻质感。"
              maxLength={1200}
              rows={6}
              required
            />
            <small className="interior-image-length">
              {prompt.length} / 1200
            </small>
            <div className="interior-prompt-options" aria-label="描述灵感">
              {suggestions.map(([label, text]) => (
                <button
                  key={label}
                  type="button"
                  disabled={!reference || sending}
                  onClick={() =>
                    draft.update({
                      prompt: prompt.trim()
                        ? `${prompt.trim()}\n${text}`.slice(0, 1200)
                        : text,
                    })
                  }
                >
                  {label} <span>＋</span>
                </button>
              ))}
            </div>
            {current?.error && (
              <div className="interior-form-error" role="alert">
                {current.error}
                <small>底图和描述仍在，调整后可以再次生成。</small>
              </div>
            )}
            <button
              type="submit"
              className="primary-button interior-generate"
              disabled={
                !reference || !ready || busy || !!action || !prompt.trim()
              }
            >
              <Sparkles size={17} />
              {sending
                ? "正在提交…"
                : running
                  ? "正在生成，请稍候"
                  : current?.error
                    ? "用当前描述重新生成"
                    : imageUrl
                      ? "再生成一张"
                      : "生成效果图"}
            </button>
            {!reference && (
              <p className="field-note">先在左侧选择一个三维视角。</p>
            )}
            <div className="interior-connection">
              <span
                className={`interior-connection-dot${ready ? " available" : ""}`}
              />
              <strong>
                {offline
                  ? "工作台暂未连接"
                  : capability?.available
                    ? "使用本机 Codex 生图"
                    : capability
                      ? "需要连接生图环境"
                      : "正在检查生图环境"}
              </strong>
              <p>
                {offline
                  ? "连接恢复后重新同步，草稿会保留。"
                  : capability?.message}
              </p>
              {!ready && (
                <button
                  type="button"
                  className="text-button"
                  onClick={onConnections}
                >
                  <PlugZap size={14} />
                  检查 AI 接入
                </button>
              )}
            </div>
            <details className="interior-privacy">
              <summary>生成与隐私说明</summary>
              <p>
                确认生成后，仅将这张底图和描述发送给 OpenAI
                ImageGen。不会改变户型原图或三维模型，也不会切换其他功能的默认
                AI 来源。需要本机 Codex 已登录并拥有生图权限。
              </p>
            </details>
          </form>
        </div>
      )}
    </section>
  );
}
