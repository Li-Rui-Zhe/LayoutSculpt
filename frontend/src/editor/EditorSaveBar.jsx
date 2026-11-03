import { Check, Save, Circle, AlertCircle } from "lucide-react";
import OperationStatus from "../components/OperationStatus.jsx";
import { editorSaveStatus } from "./saveStatus.js";

export default function EditorSaveBar({
  draft,
  reviewing,
  isScene,
  job,
  acknowledged,
  setAcknowledged,
  busy,
  name,
  onNameChange,
  issues,
  adviceCount = 0,
  drawing,
  pendingDelete,
  openingKind,
  placement,
  save,
  error,
  completion,
  proposalPreview = false,
}) {
  const status = editorSaveStatus(draft, proposalPreview);
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
        <small>
          {reviewing
            ? "修改后请再次对照原图确认结构"
            : adviceCount && !issues.length
              ? `有 ${adviceCount} 项布局建议，仍可保存并生成三维`
              : isScene
                ? "画布可实时调整；生成三维版本后，预览与导出才会更新。"
                : "修改会自动保存为草稿；生成三维版本后，预览与导出才会更新。"}
        </small>
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
      ) : (
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
      )}
      <button
        className="primary-button"
        disabled={
          busy ||
          proposalPreview ||
          (reviewing && !acknowledged) ||
          !!issues.length ||
          !name.trim() ||
          !!drawing ||
          !!pendingDelete ||
          !!openingKind ||
          !!placement
        }
        onClick={save}
      >
        <Save size={15} />
        {proposalPreview
          ? "请先应用或退出建议预览"
          : busy
            ? "正在提交…"
            : placement
              ? "请先完成或取消放置"
              : reviewing
                ? "确认修改并继续生成"
                : "保存并生成三维"}
      </button>
    </div>
  );
}
