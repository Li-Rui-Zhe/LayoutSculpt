import { useEffect, useState } from "react";
import Modal from "../components/Modal.jsx";
import ProjectTargetSelect from "../library/ProjectTargetSelect.jsx";
import { api } from "../api.js";
import { toDraft, restorableDraft } from "../editor/geometry.js";
import { wallSides } from "../editor/designTools.js";

export default function ApplySurfaceDialog({
  material,
  category,
  jobs,
  currentId,
  currentDraft,
  onApply,
  onClose,
}) {
  const [jobId, setJobId] = useState(currentId || "");
  const [loaded, setLoaded] = useState(null),
    [error, setError] = useState("");
  const [targetId, setTargetId] = useState(""),
    [side, setSide] = useState("left");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setLoaded(null);
    setTargetId("");
    setError("");
    if (!jobId) return;
    if (
      currentDraft?.jobId === jobId &&
      restorableDraft(currentDraft.document)
    ) {
      setLoaded({ jobId, document: currentDraft.document });
      return;
    }
    try {
      const local = JSON.parse(localStorage.getItem(`habitat-edit:${jobId}`));
      if (restorableDraft(local?.document)) {
        setLoaded({ jobId, document: local.document });
        return;
      }
    } catch {
      /* 缓存不可用时读取服务端。 */
    }
    const controller = new AbortController();
    const read = async () => {
      try {
        const draft = await api(`/drafts/edit:${jobId}`, {
          signal: controller.signal,
        });
        const document = restorableDraft(draft.document)
          ? draft.document
          : toDraft(
              await api(`/jobs/${jobId}/artifacts/layout.json`, {
                signal: controller.signal,
              }),
            );
        if (!controller.signal.aborted) setLoaded({ jobId, document });
      } catch (e) {
        if (!controller.signal.aborted) setError(e.message);
      }
    };
    void read();
    return () => controller.abort();
  }, [jobId, retry, currentDraft]);
  const doc = loaded?.jobId === jobId ? loaded.document : null;
  const type = category === "floor" ? "rooms" : "walls";
  const targets = doc?.layout[type].filter((item) => !item.edit_hidden) || [];
  const target = targets.find((item) => item.id === targetId);
  return (
    <Modal
      title={`应用${category === "floor" ? "地板" : "墙面"} · ${material.name}`}
      onClose={onClose}
      className="surface-apply-dialog"
    >
      <p>材质已保存。选择位置后进入人工设计，可撤销；生成新版本后更新导出。</p>
      <label>
        目标户型
        <ProjectTargetSelect
          jobs={jobs}
          value={jobId}
          currentId={currentId}
          label="材质目标户型"
          onChange={setJobId}
        />
      </label>
      {jobId && !doc && !error && <p role="status">正在读取可应用的位置…</p>}
      {error && (
        <p role="alert">
          {error} <button onClick={() => setRetry((v) => v + 1)}>重试</button>
        </p>
      )}
      {doc && (
        <label>
          {type === "rooms" ? "房间地板" : "目标墙体"}
          <select
            aria-label="材质应用位置"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">请选择具体位置</option>
            {targets.map((item, index) => (
              <option key={item.id} value={item.id} disabled={item.edit_locked}>
                {type === "rooms"
                  ? item.name
                  : `墙体 ${index + 1} · ${wallSides(item, doc.layout.rooms)
                      .map((s) => s.room)
                      .join(" / ")}`}
                {item.edit_locked ? " · 已锁定" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {target && type === "walls" && (
        <label>
          应用范围
          <select
            aria-label="墙面应用范围"
            value={side}
            onChange={(e) => setSide(e.target.value)}
          >
            {wallSides(target, doc.layout.rooms).map((s) => (
              <option key={s.side} value={s.side}>
                {s.label} 面 · {s.room}
              </option>
            ))}
            <option value="both">整面墙（两侧）</option>
          </select>
        </label>
      )}
      <button
        className="primary-button"
        disabled={!target || target.edit_locked}
        onClick={() =>
          onApply({
            jobId,
            materialId: material.id,
            category,
            edit: true,
            targetId,
            side,
          })
        }
      >
        应用并查看
      </button>
    </Modal>
  );
}
