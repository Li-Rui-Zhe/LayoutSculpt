import { Check, Save, LoaderCircle } from "lucide-react";
import OperationStatus from "../components/OperationStatus.jsx";

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
}) {
  return (
    <div className="edit-save-bar">
      <div>
        <OperationStatus
          active={busy}
          label="正在提交设计版本"
          detail="提交后会在任务列表继续建模，当前草稿保留。"
        />
        <span>
          <Check size={13} />
          {draft.storageError ? "草稿同步异常，请检查提示" : draft.syncStatus}
          {draft.dirty ? " · 导出模型待更新" : " · 与已生成模型一致"}
        </span>
        <small>
          {reviewing
            ? "修改后请再次对照原图确认结构"
            : adviceCount && !issues.length
              ? `有 ${adviceCount} 项布局建议，仍可保存并生成三维`
              : isScene
                ? "三维拖动或输入尺寸 → 热更新 → 保存为独立版本"
                : "平面绘制或输入尺寸 → 检查布局 → 保存为独立版本"}
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
        {busy ? (
          <LoaderCircle size={15} className="spin" />
        ) : (
          <Save size={15} />
        )}
        {placement
          ? "请先放置或取消家具"
          : reviewing
            ? "确认修改并继续生成"
            : "保存并生成三维"}
      </button>
    </div>
  );
}
