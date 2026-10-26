import "./floorRoomTarget.css";

export default function FloorRoomTarget({ rooms, value, onChange, disabled }) {
  const room = rooms.find((item) => item.id === value);
  return (
    <div className="floor-room-target">
      <label>
        <span>房间</span>
        <select
          aria-label="地板应用房间"
          value={room?.id || ""}
          disabled={disabled || !rooms.length}
          onChange={(event) => onChange(event.target.value)}
        >
          {!room && (
            <option value="">
              {rooms.length ? "请选择房间" : "请先添加空间"}
            </option>
          )}
          {rooms.map((item, index) => (
            <option key={item.id} value={item.id}>
              {item.name || `空间 ${index + 1}`}
              {item.floor_enabled === false ? " · 未铺地板" : ""}
              {item.edit_hidden ? " · 已隐藏" : ""}
            </option>
          ))}
        </select>
      </label>
      {room?.edit_hidden && <small>此空间已隐藏</small>}
    </div>
  );
}
