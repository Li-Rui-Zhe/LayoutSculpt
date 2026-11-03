import { useState } from "react";
import FurnitureSizing from "./FurnitureSizing.jsx";
import AttachmentField from "./AttachmentField.jsx";

export default function FurnitureExtras({
  document,
  item,
  onApply,
  onParentChange,
}) {
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  return (
    <>
      <FurnitureSizing item={item} onApply={onApply} />
      <details
        className="property-disclosure"
        onToggle={(event) => setAttachmentsOpen(event.currentTarget.open)}
      >
        <summary>家具联动</summary>
        {attachmentsOpen && (
          <AttachmentField
            document={document}
            item={item}
            onChange={onParentChange}
          />
        )}
      </details>
    </>
  );
}
