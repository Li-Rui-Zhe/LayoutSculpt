import { useEffect, useState, useRef } from "react";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Map,
  X,
  ChevronRight,
  CircleHelp,
} from "lucide-react";
import { presets } from "../catalog.js";
import "./roomTour.css";

const movementButtons = [
  { direction: "forward", label: "前进", key: "W", Icon: ArrowUp },
  { direction: "left", label: "左移", key: "A", Icon: ArrowLeft },
  { direction: "backward", label: "后退", key: "S", Icon: ArrowDown },
  { direction: "right", label: "右移", key: "D", Icon: ArrowRight },
];

function MoveButton({ direction, label, keyLabel, Icon, viewer }) {
  const release = () => viewer.current?.tourMove(direction, false);
  useEffect(() => release, [direction, viewer]);
  return (
    <button
      type="button"
      className={`tour-move-button ${direction}`}
      aria-label={`${label}，按住连续移动`}
      title={`${label} · 按住按钮或 ${keyLabel}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || e.isPrimary === false) return;
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        viewer.current?.tourMove(direction, true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onBlur={release}
      onKeyDown={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        viewer.current?.tourMove(direction, true);
      }}
      onKeyUp={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        release();
      }}
      onClick={(e) => {
        // 读屏软件的虚拟点击没有按压过程，提供一次小步移动。
        if (e.detail === 0) viewer.current?.tourStep(direction);
      }}
    >
      <Icon size={17} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export default function RoomTourOverlay({
  tour,
  viewer,
  onExit,
  preset,
  onPreset,
}) {
  const [mapOpen, setMapOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const mapPosition = useRef(null);
  useEffect(() => {
    if (!mapOpen || !tour.moving) return;
    let frame;
    const update = () => {
      const position = viewer.current?.cameraState()?.position;
      if (position && mapPosition.current) {
        mapPosition.current.setAttribute("cx", String(position[0]));
        mapPosition.current.setAttribute("cy", String(position[2]));
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [mapOpen, tour.moving, viewer]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onExit]);
  const room = tour.rooms.find((r) => r.id === tour.room);
  const points = tour.rooms.flatMap((r) => r.polygon);
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const minX = Math.min(...xs),
    minY = Math.min(...ys),
    width = Math.max(...xs) - minX,
    height = Math.max(...ys) - minY;
  const connected = tour.portals
    .filter((p) => p.rooms.includes(tour.room))
    .map((p) => p.rooms.find((id) => id !== tour.room));
  return (
    <section className="room-tour-overlay" aria-label="室内漫游导航">
      <div className="tour-heading">
        <button className="tour-back" onClick={onExit}>
          <ArrowLeft size={16} />
          返回鸟瞰
        </button>
        <div>
          <small>看看我家 · 当前设计</small>
          <h3>{room?.name}</h3>
        </div>
        <div className="tour-lighting" role="group" aria-label="室内光照">
          {presets.map((p) => (
            <button
              key={p.id}
              aria-pressed={preset === p.id}
              onClick={() => onPreset?.(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <button
          className="tour-map-toggle"
          aria-expanded={mapOpen}
          onClick={() => {
            setMapOpen((v) => !v);
          }}
        >
          <Map size={16} />
          房间地图
        </button>
      </div>
      {!!tour.recommendations?.length && (
        <nav className="tour-recommended" aria-label="房间推荐视角">
          <span>推荐视角</span>
          {tour.recommendations.map((room) => (
            <button
              key={room.id}
              onClick={() => viewer.current?.recommendedRoom(room.id)}
              title={`看看${room.name}的推荐角度`}
            >
              {room.name}
            </button>
          ))}
        </nav>
      )}
      {mapOpen && (
        <aside className="tour-map-panel" aria-label="房间地图">
          <header>
            <b>你在这里</b>
            <button aria-label="收起地图" onClick={() => setMapOpen(false)}>
              <X size={16} />
            </button>
          </header>
          <svg
            viewBox={`${minX - 0.6} ${minY - 0.6} ${width + 1.2} ${height + 1.2}`}
            role="img"
            aria-label="当前位置地图，使用下方房间按钮切换"
          >
            {tour.rooms.map((r) => (
              <polygon
                key={r.id}
                points={r.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
                className={r.id === tour.room ? "current" : ""}
              />
            ))}
            {tour.position && (
              <circle
                ref={mapPosition}
                cx={tour.position.x}
                cy={tour.position.y}
                r={0.16}
                className="here"
              />
            )}
          </svg>
          <div className="tour-room-list">
            {tour.rooms.map((r) => (
              <button
                key={r.id}
                disabled={!r.stations.length}
                aria-current={r.id === tour.room ? "location" : undefined}
                onClick={() => viewer.current?.tourRoom(r.id)}
              >
                <span>{r.name}</span>
                <small>
                  {!r.stations.length
                    ? "暂无落脚空间"
                    : r.id === tour.room
                      ? "当前位置"
                      : connected.includes(r.id)
                        ? "相邻房间"
                        : "快速切换"}
                </small>
                <ChevronRight size={12} />
              </button>
            ))}
          </div>
          <p>门洞和开放通道可直接走过；地图和门口箭头用于快速切换。</p>
        </aside>
      )}
      <div className="tour-movement-pad" role="group" aria-label="移动方向">
        <span className="tour-pad-label">按住移动 · WASD</span>
        <div className="tour-pad-buttons">
          {movementButtons.map(({ key, ...button }) => (
            <MoveButton
              key={button.direction}
              {...button}
              keyLabel={key}
              viewer={viewer}
            />
          ))}
        </div>
      </div>
      <div className="tour-bottom">
        <div className="tour-hint-header">
          <span>点击地面前往 · 拖动环顾</span>
          <button
            type="button"
            className="tour-help-toggle"
            aria-expanded={helpOpen}
            aria-label={helpOpen ? "收起操作说明" : "展开操作说明"}
            onClick={() => setHelpOpen((v) => !v)}
          >
            <CircleHelp size={14} />
          </button>
        </div>
        {(tour.message || (tour.moving && !tour.manual)) && (
          <p className="tour-move-status" role="status">
            {tour.message || "正在移向落点…"}
          </p>
        )}
        {helpOpen && (
          <small className="tour-help-detail">
            WASD 移动 · Shift 加速 · 方向键环顾
            <br />
            滚轮调整视野 · Esc 返回
            <br />
            家具可穿过，近处遮挡会自动淡化；门洞可直接通过。
          </small>
        )}
      </div>
      <span className="tour-room-announcement" role="status">
        当前：{room?.name}
      </span>
    </section>
  );
}
