import NumberField from "./NumberField.jsx";
import AttachmentField from "./AttachmentField.jsx";
import { useState } from "react";

function LayerDetails({ layer, children }) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {layer.name}
        {layer.visible === false ? " · 已隐藏" : ""}
      </summary>
      {open && children}
    </details>
  );
}

export default function PresentationLayers({ document, onChange, disabled }) {
  const layers = document.layout.presentation_layers || [];
  if (!layers.length) return null;
  const update = (id, patch) =>
    onChange({
      ...document,
      layout: {
        ...document.layout,
        presentation_layers: layers.map((layer) =>
          layer.id === id ? { ...layer, ...patch } : layer,
        ),
      },
    });
  return (
    <details className="editor-tools-disclosure presentation-layers">
      <summary>展示陈设 · {layers.length} 组</summary>
      <p>
        示例中的织物、摆件和庭院陈设会随设计保存。这里按区域成组调整；家具本体仍在对象列表中单独编辑。
      </p>
      <p>
        已绑定墙体的窗帘与挂画随墙移动；删除承托墙后会隐藏并保留，可重新显示或撤销。
      </p>
      <fieldset disabled={disabled}>
        {layers.map((layer) => (
          <LayerDetails key={layer.id} layer={layer}>
            <label>
              <input
                type="checkbox"
                checked={layer.visible !== false}
                onChange={(event) =>
                  update(layer.id, { visible: event.target.checked })
                }
              />
              显示这组陈设
            </label>
            <AttachmentField
              document={document}
              item={layer}
              onChange={(parent_furniture_id) =>
                update(layer.id, { parent_furniture_id, parent_wall_id: null })
              }
            />
            {layer.parent_wall_id && (
              <p>
                随墙体移动 ·{" "}
                <button
                  type="button"
                  onClick={() => update(layer.id, { parent_wall_id: null })}
                >
                  解除墙体联动
                </button>
              </p>
            )}
            <div className="edit-number-grid">
              <NumberField
                label={`${layer.name} X`}
                value={layer.x}
                onCommit={(x) => update(layer.id, { x })}
              />
              <NumberField
                label={`${layer.name} Y`}
                value={layer.y}
                onCommit={(y) => update(layer.id, { y })}
              />
              <NumberField
                label={`${layer.name} 高度`}
                value={layer.elevation}
                onCommit={(elevation) => update(layer.id, { elevation })}
              />
              <NumberField
                label={`${layer.name} 角度`}
                unit="°"
                min={-360}
                max={360}
                value={layer.rotation || 0}
                onCommit={(rotation) => update(layer.id, { rotation })}
              />
            </div>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...document,
                  layout: {
                    ...document.layout,
                    presentation_layers: layers.filter(
                      (item) => item.id !== layer.id,
                    ),
                  },
                })
              }
            >
              删除这组陈设
            </button>
          </LayerDetails>
        ))}
      </fieldset>
    </details>
  );
}
