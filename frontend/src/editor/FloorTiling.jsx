import NumberField from "./NumberField.jsx";
export default function FloorTiling({ room, onChange }) {
  return (
    <details className="edit-advanced">
      <summary>块材规格与拼缝</summary>
      <label className="edit-label">
        铺贴方式
        <select
          aria-label="地板铺贴方式"
          value={room.floor_pattern || "texture"}
          onChange={(e) => onChange("floor_pattern", e.target.value)}
        >
          <option value="texture">原材质纹理</option>
          <option value="tiles">按实际块材尺寸铺贴</option>
        </select>
      </label>
      {room.floor_pattern === "tiles" && (
        <>
          <p className="field-note">
            按矩形块材宽深直铺，沿用上方方向，替换原有人字拼等拼花方式。此模式忽略纹理比例；自定义图片请使用单块无缝纹理。
          </p>
          <div className="edit-number-grid">
            <NumberField
              label="块材宽度"
              value={room.floor_tile_width ?? 0.6}
              min={0.05}
              max={3}
              onCommit={(v) => onChange("floor_tile_width", v)}
            />
            <NumberField
              label="块材深度"
              value={room.floor_tile_depth ?? 0.6}
              min={0.05}
              max={3}
              onCommit={(v) => onChange("floor_tile_depth", v)}
            />
            <NumberField
              label="拼缝宽度"
              value={(room.floor_grout ?? 0.003) * 1000}
              min={0}
              max={20}
              unit="mm"
              onCommit={(v) => onChange("floor_grout", v / 1000)}
            />
          </div>
          <label className="edit-label">
            美缝颜色
            <select
              aria-label="美缝颜色"
              value={room.floor_grout_color || "#b9b5ad"}
              onChange={(e) => onChange("floor_grout_color", e.target.value)}
            >
              <option value="#b9b5ad">暖灰</option>
              <option value="#e5e1d9">象牙白</option>
              <option value="#6f706c">深灰</option>
              <option value="#cbb99d">米砂</option>
            </select>
          </label>
        </>
      )}
    </details>
  );
}
