import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import ModelFields from "../components/ModelFields.jsx";
import { useModels } from "../hooks/useModels.js";

function ReviewForm({ job, document, selected, onApply, onLocate }) {
  const models = useModels({
    initialModel: job.options?.model,
    initialEffort: job.options?.reasoning_effort,
  });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(null);
  const request = useRef(null),
    latest = useRef(document);
  latest.current = document;
  useEffect(() => () => request.current?.abort(), []);
  const target = document.layout[selected.type]?.[selected.index];
  const stale = result && result.base !== JSON.stringify(document);
  const run = async () => {
    if (request.current || !target) return;
    const controller = new AbortController();
    request.current = controller;
    const base = JSON.stringify(document);
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await api(`/jobs/${job.id}/review-local`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        timeoutMs: 190000,
        body: JSON.stringify({
          ...document,
          target_type: selected.type,
          target_id: target.id,
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
    <div className="local-review-form">
      <p className="field-note">
        使用原图复核所选房间及相邻墙，或单面墙及门窗通道。建议经检查后再应用，可撤销。
      </p>
      <ModelFields models={models} idPrefix={`local-${job.id}`} />
      <label className="field">
        需要重点检查什么
        <textarea
          maxLength={1500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="例如：这面墙应有一扇窗，核对窗宽和位置"
        />
      </label>
      <button
        className="secondary-button"
        disabled={busy || !models.selected || target?.edit_locked}
        onClick={run}
      >
        {busy ? "正在复核所选区域…" : "AI 复核所选区域"}
      </button>
      {busy && (
        <button
          className="text-button"
          onClick={() => {
            request.current?.abort();
            request.current = null;
            setBusy(false);
          }}
        >
          取消等待
        </button>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div aria-live="polite">
          <p>{result.summary}</p>
          {[...result.changes, ...result.issues].map((issue, index) => (
            <button
              className="review-issue"
              key={index}
              onClick={() => onLocate(issue.target_type, issue.target_id)}
            >
              {index < result.changes.length ? "建议" : "待核对"} · {issue.text}
              <small>定位 {issue.target_id}</small>
            </button>
          ))}
          {stale && (
            <p className="field-error">
              草稿已变化，请重新复核后再应用，避免覆盖新的修改。
            </p>
          )}
          {!!result.changes.length && (
            <button
              className="primary-button"
              disabled={stale || busy}
              onClick={() => {
                if (result.base !== JSON.stringify(latest.current)) return;
                onApply({ ...latest.current, layout: result.layout });
                setResult(null);
              }}
            >
              应用已校验的局部建议
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function LocalReview(props) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="local-review"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>AI 局部复核</summary>
      {open && <ReviewForm {...props} />}
    </details>
  );
}
