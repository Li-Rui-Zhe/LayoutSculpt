import { useRef, useState } from "react";
import Modal from "./Modal.jsx";
import ModelFields from "./ModelFields.jsx";
import { useModels } from "../hooks/useModels.js";

export default function RetryDialog({ job, projects, onClose }) {
  const models = useModels({
    initialModel: job.options.model,
    initialEffort: job.options.reasoning_effort,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const submit = async () => {
    if (locked.current || !models.ready) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await projects.retry(job.id, {
        model: models.model,
        reasoning_effort: models.effort || null,
      });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title="选择模型并重试"
      onClose={() => !busy && onClose()}
      className="retry-dialog"
    >
      <p className="field-note">
        沿用原户型图和设计要求，创建独立的新任务。可以更换生成模型和推理强度。
      </p>
      <fieldset disabled={busy} className="retry-model-fields">
        <ModelFields models={models} idPrefix="retry" />
      </fieldset>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="primary-button full-width"
        disabled={busy || !models.ready}
        onClick={submit}
      >
        {busy ? "正在创建重试任务…" : "创建重试任务"}
      </button>
    </Modal>
  );
}
