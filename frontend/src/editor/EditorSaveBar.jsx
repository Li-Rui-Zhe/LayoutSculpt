import { Check, Save, Circle, AlertCircle, Eye } from "lucide-react";
import OperationStatus from "../components/OperationStatus.jsx";
import { editorSaveStatus, editorPrimaryAction } from "./saveStatus.js";

export default function EditorSaveBar({
  draft,
  reviewing,
  job,
  acknowledged,
  setAcknowledged,
  busy,
  name,
  onNameChange,
  issues,
  drawing,
  pendingDelete,
  openingKind,
  placement,
  save,
  onPreview,
  error,
  completion,
  proposalPreview = false,
}) {
  const status = editorSaveStatus(draft, proposalPreview);
  const action = editorPrimaryAction({
    draft,
    reviewing,
    acknowledged,
    busy,
    proposalPreview,
    issues,
    name,
    drawing,
    pendingDelete,
    openingKind,
    placement,
  });
  const StatusIcon =
    status.kind === "saved"
      ? Check
      : status.kind === "warning"
        ? AlertCircle
        : Circle;
  return (
    <div className="edit-save-bar">
      <div>
        <OperationStatus
          active={busy && !completion.completed}
          onIdle={completion.onIdle}
          failed={!!error}
          successLabel="设计版本已提交"
          label="正在提交设计版本"
          detail="提交后会在任务列表继续建模，当前草稿保留。"
        />
        <span role="status" data-save-state={status.kind}>
          <StatusIcon size={13} />
          {status.text}
        </span>
        {!action.disabled && (
          <small className="editor-next-step">{action.detail}</small>
        )}
        {reviewing && (
          <a
            className="text-button"
            href={job.source_url}
            target="_blank"
            rel="noreferrer"
          >
            打开原图对照 ↗
          </a>
        )}
      </div>
      {reviewing ? (
        <label className="review-ack">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            disabled={busy}
          />
          我已核对修改后的墙体和门窗
        </label>
      ) : draft.dirty ? (
        <details className="editor-version">
          <summary>版本设置</summary>
          <label>
            版本名称
            <input
              aria-label="设计版本名称"
              value={name}
              maxLength={120}
              disabled={busy}
              onChange={(e) => {
                onNameChange(e.target.value);
              }}
            />
          </label>
        </details>
      ) : null}
      <button
        className="primary-button"
        disabled={action.disabled}
        title={action.detail}
        onClick={action.preview ? onPreview : save}
      >
        {action.preview ? <Eye size={15} /> : <Save size={15} />}
        {action.label}
      </button>
    </div>
  );
}
