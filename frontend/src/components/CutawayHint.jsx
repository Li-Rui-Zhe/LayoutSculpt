import { Info } from "lucide-react";
import "./cutawayHint.css";

export default function CutawayHint({ editing = false, revealed = false }) {
  return (
    <details className="cutaway-hint">
      <summary aria-label="剖切显示说明" title="剖切显示说明">
        <Info size={14} aria-hidden="true" />
      </summary>
      <p role="note">
        {revealed
          ? "选中的壁挂空调已临时显示，方便调整；取消选择后恢复隐藏。"
          : "剖切时隐藏壁挂空调，切换完整墙体即可查看。空调仍保留在设计中。"}
        {editing && !revealed && "在对象列表选中空调，也可临时显示并调整。"}
      </p>
    </details>
  );
}
