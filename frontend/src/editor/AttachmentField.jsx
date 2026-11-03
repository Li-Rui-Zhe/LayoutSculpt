import { parentOptions } from "./attachments.js";

export default function AttachmentField({ document, item, onChange }) {
  return (
    <label className="edit-label">
      跟随家具
      <select
        aria-label={`${item.name || "当前对象"}跟随家具`}
        value={item.parent_furniture_id || ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">独立摆放</option>
        {parentOptions(document, item).map((parent) => (
          <option key={parent.edit_id} value={parent.edit_id}>
            {parent.name || parent.kind} ·{" "}
            {document.layout.rooms.find((r) => r.id === parent.room_id)?.name ||
              ""}
          </option>
        ))}
      </select>
      <small>
        绑定时保持原位；之后随家具移动和旋转，放在顶面的物品随高度调整。可随时解除。
      </small>
    </label>
  );
}
