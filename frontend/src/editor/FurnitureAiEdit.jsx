import { useEffect, useRef, useState, useMemo } from "react";
import { api } from "../api.js";
import { useModels } from "../hooks/useModels.js";
import ModelFields from "../components/ModelFields.jsx";

function EditForm({ job, document, item, onPreview, onApply }) {
  const models = useModels({
    initialModel: job.options?.model,
    initialEffort: job.options?.reasoning_effort,
    requiresImage: false,
  });
  const [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(null),
    [previewing, setPreviewing] = useState(false);
  const request = useRef(null),
    latest = useRef(document),
    preview = useRef(onPreview);
  latest.current = document;
  preview.current = onPreview;
  useEffect(
    () => () => {
      request.current?.abort();
      preview.current(null);
    },
    [],
  );
  const base = useMemo(() => JSON.stringify(document), [document]),
    stale = !!result && result.base !== base;
  useEffect(() => {
    if (stale) {
      preview.current(null);
      setPreviewing(false);
    }
  }, [stale]);
  const proposalDocument = () => ({
    ...document,
    furniture: {
      ...document.furniture,
      items: document.furniture.items.map((f) =>
        f.edit_id === item.edit_id ? result.item : f,
      ),
    },
  });
  const run = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    setPreviewing(false);
    onPreview(null);
    try {
      const response = await api(`/jobs/${job.id}/furniture-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        timeoutMs: 190000,
        body: JSON.stringify({
          ...document,
          name: "家具局部建议",
          target_id: item.edit_id,
          notes,
          model: models.model || null,
          reasoning_effort: models.effort || null,
        }),
      });
      if (!controller.signal.aborted) setResult({ ...response, base });
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <div className="furniture-ai-form">
      <p>
        只调整“{item.name || "所选家具"}
        ”，先预览再应用。房屋结构与其他家具保持原样。
      </p>
      <textarea
        aria-label="家具调整要求"
        placeholder="例如：换成小一些的两人沙发，旁边留出过道"
        maxLength={1500}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <details>
        <summary>模型设置</summary>
        <ModelFields models={models} idPrefix={`furniture-ai-${job.id}`} />
      </details>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || !notes.trim() || !models.selected || item.edit_locked}
        onClick={run}
      >
        {busy ? "正在提出调整建议…" : "生成单件调整建议"}
      </button>
      {busy && (
        <button type="button" onClick={() => request.current?.abort()}>
          取消等待
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div>
          <p>{result.summary}</p>
          {result.warnings.map((text, i) => (
            <p key={i}>摆放提醒：{text}</p>
          ))}
          {stale && <p role="status">设计已有新修改，请重新生成建议。</p>}
          <button
            type="button"
            disabled={stale || busy}
            onClick={() => {
              onPreview(previewing ? null : proposalDocument());
              setPreviewing((v) => !v);
            }}
          >
            {previewing ? "返回原设计" : "在画布预览建议"}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={stale || busy}
            onClick={() => {
              if (result.base !== JSON.stringify(latest.current)) return;
              const accepted = onApply(proposalDocument());
              if (accepted === true) {
                onPreview(null);
                setPreviewing(false);
                setResult(null);
              } else
                setError(
                  typeof accepted === "string"
                    ? accepted
                    : "当前无法应用，请结束正在进行的操作。",
                );
            }}
          >
            应用建议（可撤销）
          </button>
        </div>
      )}
    </div>
  );
}

export default function FurnitureAiEdit(props) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="property-disclosure"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>用一句话调整这件家具</summary>
      {open && <EditForm {...props} />}
    </details>
  );
}
