import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import RotationControl from "./RotationControl.jsx";
import DiyPreview from "../diy/DiyPreview.jsx";
import { createPreviewQueue } from "./previewQueue.js";
import { selectionFromHit, liveObjects } from "./liveModel.js";
import { apiErrorMessage } from "../apiErrors.js";
import SceneSyncStatus from "./SceneSyncStatus.jsx";
import { preparePreviewDocument } from "./previewDocument.js";
import { previewKey, previewFeedback } from "./previewIdentity.js";

export default function LivePreview({
  document,
  committedDocument,
  jobId,
  selected,
  selectionType = null,
  active = true,
  busy,
  editError,
  onDismissEditError,
  onSelect,
  onGesture,
  onRotate,
  onRotationPreview,
  onRotationFinish,
  onRotationCancel,
  placement,
  onPlacementMove,
  onPlacementConfirm,
  focusRequest,
  savedModelUrl,
  savedDocument,
}) {
  const [cutaway, setCutaway] = useState(true);
  const [rotationOpen, setRotationOpen] = useState(false);
  useEffect(
    () => setRotationOpen(false),
    [selected?.type, selected?.index, jobId],
  );
  const [hasVisibleModel, setHasVisibleModel] = useState(false);
  const [model, setModel] = useState(null),
    [state, setState] = useState({ phase: "pending" }),
    [retry, setRetry] = useState(0);
  const queue = useRef(null),
    currentUrl = useRef(null),
    revision = useRef(0),
    latest = useRef(null);
  const readyModel = useRef(null),
    currentModel = useRef(null),
    desiredKey = useRef(null);
  currentModel.current = model;
  latest.current = { document, onSelect, onGesture };
  const input = committedDocument || document;
  const preview = useMemo(() => preparePreviewDocument(input), [input]);
  const livePreview = useMemo(
    () => (document === input ? preview : preparePreviewDocument(document)),
    [document, input, preview],
  );
  const key = useMemo(() => previewKey(preview.document), [preview.document]);
  const savedKey = useMemo(
    () => (savedDocument ? previewKey(savedDocument) : null),
    [savedDocument],
  );
  desiredKey.current = key;
  // 初次构建时先展示该项目最后保存的真实 GLB，不使用几何占位模型。
  useEffect(() => {
    if (active && savedModelUrl && savedDocument)
      setModel(
        (current) =>
          current || {
            url: savedModelUrl,
            document: savedDocument,
            fallback: true,
            key: savedKey,
            revision: 0,
          },
      );
  }, [active, savedModelUrl, savedDocument, savedKey]);
  const signature = JSON.stringify(input);
  useEffect(() => {
    if (!active) return;
    queue.current = createPreviewQueue({
      initialRevision: revision.current,
      report: (value) => {
        revision.current = value.revision;
        setState(value);
      },
      build: async (snapshot, signal, report) => {
        const displaySnapshot = preparePreviewDocument(snapshot).document;
        const timeout = AbortSignal.timeout(210000);
        let response;
        try {
          response = await guardedFetch(`/api/jobs/${jobId}/preview`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...displaySnapshot, name: "三维实时设计" }),
            signal: AbortSignal.any([signal, timeout]),
          });
          if (!response.ok) {
            const value = await response.json().catch(() => ({}));
            throw Error(apiErrorMessage(value.detail, response.status));
          }
          report({ phase: "downloading" });
          return await response.blob();
        } catch (error) {
          if (timeout.aborted && !signal.aborted)
            throw Error("模型更新等待超时，可重试同步，当前设计已保留");
          throw error;
        }
      },
      publish: ({ result, document: snapshot, revision: value }) => {
        const url = URL.createObjectURL(result);
        if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
        currentUrl.current = url;
        setModel({
          url,
          document: preparePreviewDocument(snapshot).document,
          key: previewKey(preparePreviewDocument(snapshot).document),
          revision: value,
        });
        setState({ phase: "loading", revision: value });
      },
    });
    return () => {
      queue.current?.close();
      queue.current = null;
    };
  }, [jobId, active]);
  useEffect(() => {
    if (!active) return;
    const rendered = readyModel.current;
    // 同一份已显示的模型不重复生成；切回页面、锁定对象也不应重新读条。
    if (rendered?.key === key && currentModel.current?.url === rendered.url) {
      queue.current?.cancel();
      setModel((current) =>
        current?.fallback ? { ...current, fallback: false } : current,
      );
      setState({ phase: "ready", revision: revision.current });
      return;
    }
    if (savedModelUrl && savedKey === key && retry === 0) {
      queue.current?.cancel();
      setModel({
        url: savedModelUrl,
        document: savedDocument,
        key,
        fallback: false,
        revision: revision.current,
      });
      setState({ phase: "loading", revision: revision.current });
      return;
    }
    queue.current?.submit(JSON.parse(signature));
  }, [key, jobId, active, retry, savedKey, savedModelUrl]);
  useEffect(
    () => () => {
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    },
    [],
  );
  const item = selected && liveObjects(document, selected.type)[selected.index];
  const itemLabel =
    item?.name ||
    (selected
      ? `${{ furniture: "家具", walls: "墙体", rooms: "地板 / 空间", lights: "灯具", openings: item?.kind === "window" ? "窗户" : item?.kind === "door" ? "门" : "通道" }[selected.type]} ${selected.index + 1}`
      : "点击模型选择对象");
  const dragging = document !== input;
  const feedback = previewFeedback(
    state.phase,
    hasVisibleModel,
    model?.fallback,
  );
  const status =
    state.phase === "error"
      ? `精细模型更新失败：${state.message}。${hasVisibleModel ? "当前模型已保留，可继续修改或重试。" : "请重试加载；设计草稿已保留。"}`
      : dragging
        ? "正在直接修改三维 · 松手完成，Esc 取消"
        : state.phase === "ready"
          ? "三维已同步 · 直接拖动物体摆放，右侧参数精调"
          : !hasVisibleModel
            ? "正在加载精细三维模型…"
            : "正在后台同步精细模型 · 可继续编辑";
  return (
    <section
      className="scene-editor-canvas"
      aria-label="三维设计画布"
      data-content-ready={hasVisibleModel}
    >
      <div className="scene-topbar">
        <div className="live-preview-heading">
          <strong>{placement ? "选择落点" : itemLabel}</strong>
          <span className="scene-sync" title={status} role="status">
            {dragging && state.phase !== "error" ? "调整中" : feedback.label}
          </span>
        </div>
        <div className="live-preview-light">
          {!placement &&
            selected?.type === "furniture" &&
            item &&
            !item.edit_hidden && (
              <button
                aria-expanded={rotationOpen}
                onClick={() => setRotationOpen(!rotationOpen)}
              >
                {rotationOpen ? "收起旋转" : "旋转家具"}
              </button>
            )}
          <button aria-pressed={!cutaway} onClick={() => setCutaway(!cutaway)}>
            {cutaway ? "剖切墙体" : "完整墙体"}
          </button>
        </div>
      </div>
      {(editError || state.phase === "error") && (
        <div className="scene-error" role="alert">
          <span>{editError ? `修改未应用：${editError}` : status}</span>
          {state.phase === "error" && (
            <button onClick={() => setRetry((n) => n + 1)}>重新同步</button>
          )}
          {editError && (
            <button
              type="button"
              className="scene-error-close"
              aria-label="关闭修改提示"
              title="关闭提示"
              onClick={onDismissEditError}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      <div className="scene-progress-anchor">
        <SceneSyncStatus
          state={state}
          hidden={!active || dragging}
          hasContent={hasVisibleModel}
          fallback={model?.fallback}
        />
      </div>
      {rotationOpen &&
        !placement &&
        selected?.type === "furniture" &&
        item &&
        !item.edit_hidden && (
          <div className="scene-rotation-tools">
            <RotationControl
              key={item.edit_id || selected.index}
              compact
              scene
              value={item.rotation}
              disabled={
                busy || item.edit_locked || !hasVisibleModel || model?.fallback
              }
              onChange={onRotate}
              onPreview={onRotationPreview}
              onFinish={onRotationFinish}
              onCancel={onRotationCancel}
            />
          </div>
        )}
      {model ? (
        <DiyPreview
          night={false}
          cutaway={cutaway}
          modelUrl={model.url}
          modelDocument={model.document}
          liveDocument={model.fallback ? model.document : livePreview.document}
          sceneStatus={state}
          pendingDocument={livePreview.document}
          liveSelection={selected}
          focusRequest={model.fallback ? null : focusRequest}
          selectionType={selectionType}
          liveEditable={
            !model.fallback && !busy && active && hasVisibleModel && !placement
          }
          placement={
            !model.fallback && active && !busy && hasVisibleModel
              ? placement
              : null
          }
          onPlacementMove={onPlacementMove}
          onPlacementConfirm={onPlacementConfirm}
          onSceneGesture={onGesture}
          onModelReady={(url) => {
            const loaded = currentModel.current;
            if (url !== loaded?.url) return;
            setHasVisibleModel(true);
            readyModel.current = { url, key: loaded.key };
            if (loaded.key === desiredKey.current) {
              setState({ phase: "ready", revision: revision.current });
              if (loaded.fallback)
                setModel((current) => ({ ...current, fallback: false }));
            }
          }}
          onModelError={(message, url) => {
            if (url === currentModel.current?.url)
              setState({ phase: "error", revision: model.revision, message });
          }}
          onObjectSelect={(data, visibleSnapshot) => {
            const selection = selectionFromHit(
              data,
              visibleSnapshot || model.document,
              latest.current.document,
            );
            if (selection) latest.current.onSelect(selection);
          }}
        />
      ) : (
        <div className="live-preview-wait">
          {state.phase === "error" ? (
            "精细模型加载失败，请点击重新同步。"
          ) : (
            <span>正在准备精细三维空间</span>
          )}
        </div>
      )}
    </section>
  );
}
import { guardedFetch } from "../connectionGuard.js";
