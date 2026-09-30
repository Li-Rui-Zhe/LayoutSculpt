import { useEffect, useRef, useState } from "react";
import {
  Armchair,
  Lightbulb,
  SquareDashed,
  BrickWall,
  DoorOpen,
  Route,
  Scan,
  Undo2,
  Redo2,
  RotateCcw,
  Trash2,
  Plus,
  Minus,
  Focus,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Save,
  MousePointer2,
  Check,
  AlertTriangle,
  LoaderCircle,
  Copy,
} from "lucide-react";
import NumberField from "./NumberField.jsx";
import RotationControl from "./RotationControl.jsx";
import PolygonFields from "./PolygonFields.jsx";
import { useEditDraft } from "./useEditDraft.js";
import {
  clone,
  normalizeRotation,
  rotateFurniture,
  rotationFromPointer,
  reconcileFurnitureRoom,
  round,
  bounds,
  center,
  polygonArea,
  wallLength,
  moveSelection,
  moveWall,
  openingPoints,
  freeOpening,
  problems,
  furnitureNames,
  openingNames,
  floorFinishes,
  wallFinishes,
  roomNames,
  lightNames,
  lightColors,
  toolFor,
  objectEntries,
  searchEntries,
  removeObject,
  splitRoom,
  simplePolygon,
  polygonInside,
  overlapArea,
  doorLeafPoints,
} from "./geometry.js";

const tools = [
  ["furniture", Armchair, "家具"],
  ["walls", BrickWall, "墙体"],
  ["rooms", SquareDashed, "地板 / 空间"],
  ["openings", DoorOpen, "门窗"],
  ["passages", Route, "通道"],
  ["outline", Scan, "户型轮廓"],
  ["lights", Lightbulb, "灯具"],
];
const hints = {
  lights:
    "放置灯泡、吊灯或落地灯，拖动定位并调整亮度、色温和安装高度。保存三维后切换夜晚查看照明。",
  furniture: "拖动家具移动，拖动绿色手柄旋转；右侧精确调整位置、尺寸和角度。",
  walls:
    "拖动墙线移动整面墙，拖两端圆点调整长度；相连墙角与邻近地板角点会联动。",
  rooms: "拖动空间整体或角点；右侧可新增、拆分、删除空间，独立铺设或移除地板。",
  openings: "门和窗户沿墙拖动；可调整尺寸、窗台及门扇开启方式。",
  passages:
    "独立管理无门扇的开放通道，沿墙调整位置和宽高。走廊区域可在地板 / 空间中绘制。",
  outline:
    "调整户型基座边界：拖动角点、增加或删除角点，或重新绘制轮廓。修改后检查室内对象是否越界。",
};
const floorColors = {
  default: "#e3d6b8",
  oak: "#dbc395",
  walnut: "#96785e",
  tile: "#e3e4dc",
  stone: "#b1bbbc",
};
function objects(doc, type) {
  return type === "furniture"
    ? doc.furniture.items
    : type === "outline"
      ? [{ name: "户型轮廓", polygon: doc.layout.outline }]
      : doc.layout[type];
}
function labelFor(item, type, index) {
  return type === "furniture"
    ? item.name || `${furnitureNames[item.kind]} ${index + 1}`
    : type === "lights"
      ? item.name
      : type === "walls"
        ? `墙体 ${index + 1}${item.exterior ? " · 外墙" : " · 隔墙"}`
        : ["rooms", "outline"].includes(type)
          ? item.name
          : `${openingNames[item.kind]} ${index + 1}`;
}

export default function ManualEditor({
  job,
  active: isActive,
  projects,
  onClose,
}) {
  const draft = useEditDraft(job.id);
  const [tool, setTool] = useState("furniture"),
    [selected, setSelected] = useState({ type: "furniture", index: 0 });
  const [preview, setPreview] = useState(null),
    [step, setStep] = useState(0.1),
    [zoom, setZoom] = useState(1);
  const [focusPoint, setFocusPoint] = useState(null);
  const [name, setName] = useState(
    `${job.name.replace(/\.(png|jpe?g|webp)$/i, "")} · 设计`.slice(0, 120),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [furnitureKind, setFurnitureKind] = useState("chair");
  const [lightKind, setLightKind] = useState("bulb");
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [tool]);
  const [wallId, setWallId] = useState("");
  const [drawing, setDrawing] = useState(null),
    [pendingDelete, setPendingDelete] = useState(null);
  const [deleteFurniture, setDeleteFurniture] = useState(false),
    [splitAxis, setSplitAxis] = useState("x"),
    [splitAt, setSplitAt] = useState(0);
  useEffect(() => {
    setPendingDelete(null);
    setDeleteFurniture(false);
    if (draft.document && selected?.type === "rooms") {
      const room = draft.document.layout.rooms[selected.index];
      if (room) setSplitAt(round(center(room.polygon)[splitAxis]));
    }
  }, [selected?.type, selected?.index, splitAxis]);
  useEffect(() => {
    if (!isActive) {
      drag.current = null;
      setPreview(null);
    }
  }, [isActive]);
  const svg = useRef(null),
    drag = useRef(null),
    root = useRef(null);
  const document = preview || draft.document;
  const selectedObject =
    document && selected
      ? objects(document, selected.type)[selected.index]
      : null;
  const item =
    selectedObject && toolFor(selected.type, selectedObject) === tool
      ? selectedObject
      : null;
  const issues = document ? problems(document) : [];
  const select = (type, index, object) => {
    setTool(toolFor(type, object || objects(document, type)[index]));
    setSelected({ type, index });
    setError("");
  };
  const patch = (change) => {
    if (busy || !item) return;
    draft.commit((next) => {
      change(next, objects(next, selected.type)[selected.index]);
      return next;
    });
    setError("");
  };
  const rotate = (angle) => {
    if (busy || drawing || !item || selected.type !== "furniture") return;
    draft.commit(rotateFurniture(draft.document, selected.index, angle));
    setError("");
  };
  const move = (dx, dy) => {
    if (item && !busy && !drawing)
      draft.commit(moveSelection(draft.document, selected, dx, dy));
  };
  useEffect(() => {
    const keyboard = (event) => {
      if (
        !isActive ||
        busy ||
        !draft.document ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        drag.current = null;
        setPreview(null);
        setDrawing(null);
        setPendingDelete(null);
        event.shiftKey ? draft.redo() : draft.undo();
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [isActive, busy, draft]);
  const pointAt = (event) => {
    const matrix = svg.current.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
  };
  const begin = (event, target, handle = null) => {
    if (busy || drawing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    select(target.type, target.index);
    svg.current.focus();
    svg.current.setPointerCapture(event.pointerId);
    drag.current = {
      origin: pointAt(event),
      document: draft.document,
      target,
      handle,
      latest: null,
    };
  };
  const pointerMove = (event) => {
    if (!drag.current) return;
    const p = pointAt(event),
      start = drag.current.origin;
    const dx = round(Math.round((p.x - start.x) / step) * step),
      dy = round(Math.round((p.y - start.y) / step) * step);
    const current = drag.current;
    const next =
      current.handle === "rotate"
        ? rotateFurniture(
            current.document,
            current.target.index,
            rotationFromPointer(
              current.document.furniture.items[current.target.index],
              start,
              p,
              event.shiftKey ? 15 : 1,
            ),
          )
        : moveSelection(
            current.document,
            current.target,
            dx,
            dy,
            current.handle,
          );
    drag.current.latest = next;
    setPreview(next);
  };
  const end = (event, cancel = false) => {
    const current = drag.current;
    drag.current = null;
    if (svg.current.hasPointerCapture(event.pointerId))
      svg.current.releasePointerCapture(event.pointerId);
    if (!cancel && current?.latest) draft.commit(current.latest);
    setPreview(null);
  };
  const addFurniture = () => {
    const next = clone(draft.document);
    if (next.furniture.items.length >= 90) {
      setError("最多可放置 90 件家具。");
      return;
    }
    const room =
      next.layout.rooms.find((r) => r.id === (item?.room_id || item?.id)) ||
      next.layout.rooms[0];
    if (!room) {
      setError("请先在地板 / 空间中新增一个空间，再添加家具。");
      return;
    }
    const p = center(room.polygon);
    const sizes = {
      sofa: [2, 0.85, 0.85],
      bed: [1.5, 2, 0.9],
      table: [1.2, 0.8, 0.75],
      chair: [0.45, 0.45, 0.8],
      cabinet: [1, 0.45, 1.5],
      counter: [1.2, 0.6, 0.85],
      bathtub: [0.7, 1.5, 0.6],
      toilet: [0.4, 0.65, 0.75],
      sink: [0.6, 0.45, 0.85],
      plant: [0.4, 0.4, 0.8],
      rug: [1.5, 1, 0.03],
      desk: [1.2, 0.6, 0.75],
    }[furnitureKind];
    next.furniture.items.push({
      kind: furnitureKind,
      room_id: room.id,
      x: round(p.x),
      y: round(p.y),
      width: sizes[0],
      depth: sizes[1],
      height: sizes[2],
      rotation: 0,
    });
    draft.commit(next);
    select("furniture", next.furniture.items.length - 1);
  };
  const addOpening = (kind) => {
    const next = clone(draft.document),
      wall =
        selected?.type === "walls" && item
          ? item
          : next.layout.walls.find((w) => w.id === wallId) ||
            next.layout.walls[0];
    if (next.layout.openings.length >= 80) {
      setError("最多可放置 80 个门窗或通道。");
      return;
    }
    const opening = freeOpening(next.layout, wall, kind);
    if (!opening) {
      setError("这面墙没有足够的空位，请换一面墙或缩小现有门窗。");
      return;
    }
    next.layout.openings.push(opening);
    draft.commit(next);
    select("openings", next.layout.openings.length - 1, opening);
  };
  const remove = () => {
    if (!item || busy) return;
    setPendingDelete({ ...selected });
    setDeleteFurniture(false);
  };
  const confirmRemove = () => {
    try {
      draft.commit(
        removeObject(draft.document, pendingDelete, deleteFurniture),
      );
      setSelected(null);
      setPendingDelete(null);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  const startDrawing = (type) => {
    setDrawing({ type, points: [] });
    setPendingDelete(null);
    setSelected(null);
    setZoom(1);
    setFocusPoint(null);
    setError("");
  };
  const finishDrawing = (points = drawing?.points) => {
    if (!drawing || busy) return;
    try {
      const next = clone(draft.document);
      if (drawing.type === "walls") {
        if (
          points.length !== 2 ||
          Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) <
            0.05
        )
          throw Error("墙体需要两个不同端点，长度至少 5 厘米。");
        if (next.layout.walls.length >= 120) throw Error("最多支持 120 面墙。");
        next.layout.walls.push({
          id: `manual_${crypto.randomUUID().slice(0, 12)}`,
          start: points[0],
          end: points[1],
          thickness: 0.12,
          height: 2.7,
          exterior: false,
          finish: "default",
        });
        select("walls", next.layout.walls.length - 1);
      } else {
        if (
          points.length < 3 ||
          !simplePolygon(points) ||
          polygonArea(points) < (drawing.type === "outline" ? 2 : 0.2)
        )
          throw Error(
            "请绘制至少三个不交叉的角点，空间至少 0.2 ㎡，轮廓至少 2 ㎡。",
          );
        if (drawing.type === "outline") {
          next.layout.outline = points;
          select("outline", 0);
        } else {
          if (next.layout.rooms.length >= 35)
            throw Error("最多支持 35 个空间。");
          if (!polygonInside(points, next.layout.outline))
            throw Error("新增空间必须完整位于户型轮廓内。");
          if (
            next.layout.rooms.some(
              (r) =>
                simplePolygon(r.polygon) &&
                overlapArea(points, r.polygon) > 1e-6,
            )
          )
            throw Error(
              "新增空间与已有空间重叠。请先缩小或删除原空间，也可以使用「拆分空间」。",
            );
          next.layout.rooms.push({
            id: `room_${crypto.randomUUID().slice(0, 12)}`,
            name: `新空间 ${next.layout.rooms.length + 1}`,
            kind: "other",
            polygon: points,
            floor_finish: "default",
            floor_enabled: true,
          });
          select("rooms", next.layout.rooms.length - 1);
        }
      }
      draft.commit(next);
      setDrawing(null);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  const drawPoint = (event) => {
    if (!drawing || busy || event.button !== 0) return;
    event.preventDefault();
    const p = pointAt(event),
      point = {
        x: round(Math.round(p.x / step) * step),
        y: round(Math.round(p.y / step) * step),
      };
    if (Math.abs(point.x) > 60 || Math.abs(point.y) > 60) {
      setError("坐标必须位于 -60～60 米范围。");
      return;
    }
    if (drawing.points.some((p) => p.x === point.x && p.y === point.y)) return;
    if (
      drawing.points.length >=
      (drawing.type === "outline" ? 40 : drawing.type === "walls" ? 2 : 24)
    )
      return;
    const points = [...drawing.points, point];
    setDrawing({ ...drawing, points });
    if (drawing.type === "walls" && points.length === 2) finishDrawing(points);
  };
  const save = async () => {
    if (!document || issues.length || busy || drawing || pendingDelete) return;
    const invalidInput = root.current.querySelector(
      'input:invalid, input[aria-invalid="true"]',
    );
    if (invalidInput) {
      invalidInput.focus();
      setError("请先修正标红的输入值，再保存三维版本。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await projects.edit(job.id, {
        name: name.trim() || "人工设计方案",
        ...draft.document,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!document)
    return (
      <div className="empty-state">
        <LoaderCircle size={26} className={draft.error ? "" : "spin"} />
        <h2>{draft.error ? "无法读取可编辑户型" : "正在准备人工设计页面"}</h2>
        <p>{draft.error || "读取当前任务的墙体、地板、门窗和家具数据"}</p>
        {draft.error && (
          <button className="secondary-button" onClick={draft.reload}>
            重新读取
          </button>
        )}
        <button className="text-button" onClick={onClose}>
          返回三维预览
        </button>
      </div>
    );
  const entries = objectEntries(document, tool);
  const filteredEntries = searchEntries(entries, query, document.layout.rooms);
  const openingChoices =
    tool === "passages"
      ? { passage: "开放通道" }
      : { door: "门", window: "窗户" };
  const box = bounds(draft.document.layout),
    w = box.width / zoom,
    h = box.height / zoom;
  const viewBox = `${(focusPoint?.x ?? box.x + box.width / 2) - w / 2} ${(focusPoint?.y ?? box.y + box.height / 2) - h / 2} ${w} ${h}`;
  const wall =
    selected?.type === "openings" && item
      ? document.layout.walls.find((w) => w.id === item.wall_id)
      : null;
  const active = (type, index) =>
    selected?.type === type && selected.index === index;
  const selectedName = item
    ? labelFor(item, selected.type, selected.index)
    : "选择一个对象";
  const changeWallPoint = (endpoint, axis, value) =>
    draft.commit(
      moveWall(
        draft.document,
        selected.index,
        axis === "x" ? value - item[endpoint].x : 0,
        axis === "y" ? value - item[endpoint].y : 0,
        endpoint,
      ),
    );
  const number = (label, key, min, max, unit = "m") => (
    <NumberField
      key={key}
      label={label}
      value={item[key]}
      min={min}
      max={max}
      unit={unit}
      onCommit={(value) =>
        patch((next, target) => {
          target[key] = value;
          if (
            selected.type === "furniture" &&
            ["x", "y", "width", "depth"].includes(key)
          )
            reconcileFurnitureRoom(next, target);
        })
      }
    />
  );
  return (
    <div className="manual-editor" ref={root}>
      <div className="edit-toolbar">
        <div className="edit-tool-tabs">
          {tools.map(([id, Icon, label]) => (
            <button
              key={id}
              className={tool === id ? "active" : ""}
              aria-pressed={tool === id}
              disabled={busy}
              onClick={() => {
                setTool(id);
                setDrawing(null);
                setPendingDelete(null);
                setError("");
                const first = objectEntries(document, id)[0];
                setSelected(
                  first ? { type: first.type, index: first.index } : null,
                );
              }}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
        <div className="edit-history">
          <button
            title="撤销设计"
            aria-label="撤销设计"
            onClick={() => {
              setDrawing(null);
              setPendingDelete(null);
              draft.undo();
            }}
            disabled={busy || !draft.canUndo}
          >
            <Undo2 size={16} />
          </button>
          <button
            title="重做设计"
            aria-label="重做设计"
            onClick={() => {
              setDrawing(null);
              setPendingDelete(null);
              draft.redo();
            }}
            disabled={busy || !draft.canRedo}
          >
            <Redo2 size={16} />
          </button>
          <button
            className="text-button"
            onClick={() => {
              setDrawing(null);
              setPendingDelete(null);
              setSelected(null);
              draft.reset();
              setError("");
            }}
            disabled={busy}
          >
            <RotateCcw size={13} />
            还原原方案
          </button>
          <button className="secondary-button" onClick={onClose}>
            返回三维
          </button>
        </div>
      </div>
      <div className="edit-intro">
        <MousePointer2 size={15} />
        <p>{hints[tool]}</p>
        <label>
          吸附 / 微移
          <select
            aria-label="移动步长"
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
          >
            <option value={0.1}>10 厘米</option>
            <option value={0.05}>5 厘米</option>
            <option value={0.01}>1 厘米</option>
          </select>
        </label>
      </div>
      {drawing && (
        <div className="edit-drawing-bar" role="status">
          <span>
            {drawing.type === "walls"
              ? "在图中点击起点和终点"
              : "在图中依次点击边界角点，再点击完成"}{" "}
            · 已选 {drawing.points.length} 点
          </span>
          <button
            disabled={busy || !drawing.points.length}
            onClick={() =>
              setDrawing({ ...drawing, points: drawing.points.slice(0, -1) })
            }
          >
            撤回一点
          </button>
          {drawing.type !== "walls" && (
            <button
              disabled={busy || drawing.points.length < 3}
              onClick={() => finishDrawing()}
            >
              完成绘制
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => {
              setDrawing(null);
              setError("");
            }}
          >
            取消绘制
          </button>
        </div>
      )}
      <div className="edit-columns">
        <aside
          className="edit-library edit-properties"
          aria-label="对象库与添加"
        >
          <fieldset disabled={busy || !!drawing}>
            <div className="edit-section">
              <div className="section-heading">
                <h2>对象库</h2>
                <MousePointer2 size={14} />
              </div>
              <label className="edit-label">
                查询对象
                <input
                  type="search"
                  aria-label="查询设计对象"
                  placeholder={
                    tool === "furniture"
                      ? "搜索家具名称、类型或所属空间"
                      : "搜索名称、类型或编号"
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <p className="field-note">
                找到 {filteredEntries.length} / {entries.length} 个对象
              </p>
              <div className="edit-object-list" aria-label="设计对象列表">
                {filteredEntries.map(({ object, index, type }) => (
                  <button
                    key={index}
                    aria-pressed={active(type, index)}
                    onClick={() => select(type, index)}
                  >
                    <span>{labelFor(object, type, index)}</span>
                    <small>
                      {type === "furniture"
                        ? document.layout.rooms.find(
                            (r) => r.id === object.room_id,
                          )?.name
                        : "点击编辑"}
                    </small>
                  </button>
                ))}
              </div>
              {query && !filteredEntries.length && (
                <p className="field-note">
                  没有匹配的对象，修改关键词或清空搜索。
                </p>
              )}
              {item && (
                <button
                  className="text-button"
                  onClick={() => {
                    const point = item.polygon
                      ? center(item.polygon)
                      : selected.type === "walls"
                        ? center([item.start, item.end])
                        : selected.type === "openings" && wall
                          ? center(openingPoints(item, wall))
                          : item;
                    setFocusPoint({ x: point.x, y: point.y });
                    setZoom(1.6);
                    svg.current.focus();
                  }}
                >
                  定位选中对象
                </button>
              )}
              {!entries.length && (
                <p className="field-note">当前没有此类对象，请添加新对象。</p>
              )}
            </div>
            <div className="edit-section">
              <div className="section-heading">
                <h2>添加对象</h2>
                <Plus size={14} />
              </div>
              {tool === "lights" && (
                <>
                  <div className="add-furniture">
                    <select
                      aria-label="新增灯具类型"
                      value={lightKind}
                      onChange={(e) => setLightKind(e.target.value)}
                    >
                      {Object.entries(lightNames).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        if (document.layout.lights.length >= 12) {
                          setError("最多支持 12 盏灯具。");
                          return;
                        }
                        const next = clone(document),
                          p = center(next.layout.outline);
                        next.layout.lights.push({
                          id: `light_${crypto.randomUUID().slice(0, 12)}`,
                          name: `${lightNames[lightKind]} ${next.layout.lights.length + 1}`,
                          kind: lightKind,
                          x: round(p.x),
                          y: round(p.y),
                          elevation: lightKind === "floor_lamp" ? 1.5 : 2.4,
                          lumens: 800,
                          temperature: 3000,
                          enabled: true,
                        });
                        draft.commit(next);
                        select("lights", next.layout.lights.length - 1);
                      }}
                    >
                      <Plus size={13} />
                      添加灯具
                    </button>
                  </div>
                  <p className="field-note">
                    保存并生成三维后，在设计预览切换「夜晚」。最多 12
                    盏灯，可单独开关。
                  </p>
                </>
              )}
              {tool === "furniture" && (
                <div className="add-furniture">
                  <select
                    aria-label="新增家具类型"
                    value={furnitureKind}
                    onChange={(e) => setFurnitureKind(e.target.value)}
                  >
                    {Object.entries(furnitureNames).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <button className="secondary-button" onClick={addFurniture}>
                    <Plus size={13} />
                    添加
                  </button>
                </div>
              )}
              {tool === "walls" && (
                <button
                  className="secondary-button full-width"
                  onClick={() => startDrawing("walls")}
                >
                  <Plus size={14} />
                  绘制新墙体
                </button>
              )}
              {tool === "rooms" && (
                <>
                  <button
                    className="secondary-button full-width"
                    onClick={() => startDrawing("rooms")}
                  >
                    <Plus size={14} />
                    绘制新空间 / 地板
                  </button>
                  <p className="field-note">
                    在空白区域依次点击角点。已有空间占满时，可先拆分空间或删除原空间再重画。
                  </p>
                </>
              )}
              {tool === "outline" && (
                <p className="field-note">
                  户型共用一个基座轮廓，支持重绘及角点增删改。清空室内对象不影响基座。
                </p>
              )}
              {["openings", "passages"].includes(tool) && (
                <>
                  <label className="edit-label">
                    添加到墙体
                    <select
                      aria-label="添加开口的墙体"
                      value={
                        document.layout.walls.some((w) => w.id === wallId)
                          ? wallId
                          : document.layout.walls[0]?.id || ""
                      }
                      onChange={(e) => setWallId(e.target.value)}
                    >
                      {document.layout.walls.map((wall, index) => (
                        <option key={wall.id} value={wall.id}>
                          {labelFor(wall, "walls", index)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="edit-opening-add">
                    {Object.entries(openingChoices).map(([kind, name]) => (
                      <button
                        key={kind}
                        disabled={!document.layout.walls.length}
                        onClick={() => addOpening(kind)}
                      >
                        <Plus size={12} />
                        {name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </fieldset>
        </aside>
        <section className="plan-editor-canvas">
          <div className="plan-sheet-head">
            <span>
              <i />
              俯视设计 · 单位：米
            </span>
            <small>平面即时预览，保存后更新三维</small>
          </div>
          <svg
            ref={svg}
            viewBox={viewBox}
            role="application"
            aria-label="人工设计平面图"
            tabIndex={0}
            onPointerDown={drawing ? drawPoint : undefined}
            onPointerMove={pointerMove}
            onPointerUp={(e) => end(e)}
            onPointerCancel={(e) => end(e, true)}
            onLostPointerCapture={(e) => {
              if (drag.current) end(e, true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                drag.current = null;
                setPreview(null);
                setDrawing(null);
                setPendingDelete(null);
                return;
              }
              if (drag.current) return;
              if (
                selected?.type === "furniture" &&
                ["[", "]"].includes(e.key)
              ) {
                e.preventDefault();
                rotate(
                  item.rotation +
                    (e.key === "[" ? -1 : 1) * (e.shiftKey ? 90 : 15),
                );
                return;
              }
              const offsets = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              };
              if (offsets[e.key] && item && !drawing) {
                e.preventDefault();
                move(...offsets[e.key].map((v) => v * (e.shiftKey ? 10 : 1)));
              }
            }}
          >
            <defs>
              <pattern
                id={`grid-${job.id}`}
                width=".5"
                height=".5"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M .5 0 L 0 0 0 .5"
                  fill="none"
                  stroke="#738a891c"
                  strokeWidth=".015"
                />
              </pattern>
            </defs>
            <rect
              x={box.x - 60}
              y={box.y - 60}
              width={box.width + 120}
              height={box.height + 120}
              fill="#eaf0e8"
            />
            <rect
              x={box.x - 60}
              y={box.y - 60}
              width={box.width + 120}
              height={box.height + 120}
              fill={`url(#grid-${job.id})`}
            />
            <polygon
              points={document.layout.outline
                .map((p) => `${p.x},${p.y}`)
                .join(" ")}
              onPointerDown={
                tool === "outline" && !drawing
                  ? (e) => begin(e, { type: "outline", index: 0 })
                  : undefined
              }
              fill="#d9e2d7"
              stroke="#718375"
              strokeWidth=".025"
              strokeDasharray=".09 .07"
            />
            {document.layout.rooms.map((room, index) => {
              const p = center(room.polygon);
              return (
                <g key={room.id}>
                  <polygon
                    role="button"
                    aria-label={`选择地板 ${room.name}`}
                    tabIndex={tool === "rooms" ? 0 : -1}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") select("rooms", index);
                    }}
                    points={room.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill={floorColors[room.floor_finish || "default"]}
                    fillOpacity={room.floor_enabled === false ? 0.12 : 0.78}
                    stroke={active("rooms", index) ? "#367e64" : "#b7c4b2"}
                    strokeWidth={active("rooms", index) ? 0.05 : 0.015}
                    style={{
                      pointerEvents:
                        tool === "rooms" && !drawing ? "auto" : "none",
                      cursor: "move",
                    }}
                    onPointerDown={
                      tool === "rooms"
                        ? (e) => begin(e, { type: "rooms", index })
                        : undefined
                    }
                  />
                  <text
                    x={p.x}
                    y={p.y - 0.12}
                    textAnchor="middle"
                    className="room-plan-label"
                  >
                    {room.name}
                  </text>
                  <text
                    x={p.x}
                    y={p.y + 0.13}
                    textAnchor="middle"
                    className="room-area-label"
                  >
                    {polygonArea(room.polygon).toFixed(1)} ㎡
                  </text>
                </g>
              );
            })}
            {document.layout.walls.map((wall, index) => (
              <g
                key={wall.id}
                role="button"
                aria-label={`选择墙体 ${index + 1}`}
                tabIndex={tool === "walls" ? 0 : -1}
                onKeyDown={(e) => {
                  if (e.key === "Enter") select("walls", index);
                }}
                onPointerDown={
                  tool === "walls"
                    ? (e) => begin(e, { type: "walls", index })
                    : undefined
                }
                style={{
                  pointerEvents: tool === "walls" ? "auto" : "none",
                  cursor: "move",
                }}
              >
                <line
                  x1={wall.start.x}
                  y1={wall.start.y}
                  x2={wall.end.x}
                  y2={wall.end.y}
                  stroke="transparent"
                  strokeWidth={Math.max(0.22, wall.thickness + 0.12)}
                />
                <line
                  x1={wall.start.x}
                  y1={wall.start.y}
                  x2={wall.end.x}
                  y2={wall.end.y}
                  stroke={
                    active("walls", index)
                      ? "#318765"
                      : wall.exterior
                        ? "#445a55"
                        : "#748880"
                  }
                  strokeWidth={wall.thickness}
                  strokeLinecap="square"
                />
              </g>
            ))}
            {document.layout.openings.map((opening, index) => {
              const wall = document.layout.walls.find(
                (w) => w.id === opening.wall_id,
              );
              if (!wall) return null;
              const [a, b] = openingPoints(opening, wall);
              const selectable =
                toolFor("openings", opening) === tool && !drawing;
              const color =
                opening.kind === "window"
                  ? "#5b9bab"
                  : opening.kind === "passage"
                    ? "#b18943"
                    : "#859888";
              return (
                <g
                  key={index}
                  role="button"
                  aria-label={`选择${openingNames[opening.kind]} ${index + 1}`}
                  tabIndex={selectable ? 0 : -1}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") select("openings", index);
                  }}
                  onPointerDown={
                    selectable
                      ? (e) => begin(e, { type: "openings", index })
                      : undefined
                  }
                  style={{
                    pointerEvents: selectable ? "auto" : "none",
                    cursor: "grab",
                  }}
                >
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={active("openings", index) ? "#61b78a" : "#eaf0e8"}
                    strokeWidth={wall.thickness + 0.09}
                  />
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={color}
                    strokeWidth={opening.kind === "window" ? 0.045 : 0.028}
                    strokeDasharray={
                      opening.kind === "window" ? undefined : ".08 .045"
                    }
                  />
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="transparent"
                    strokeWidth=".3"
                  />
                  {opening.kind === "door" &&
                    opening.door_leaf !== false &&
                    (() => {
                      const [h, t] = doorLeafPoints(opening, wall);
                      return (
                        <line
                          x1={h.x}
                          y1={h.y}
                          x2={t.x}
                          y2={t.y}
                          stroke="#9b704d"
                          strokeWidth=".045"
                        />
                      );
                    })()}
                  {active("openings", index) && (
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 0.25}
                      className="dimension-label"
                      textAnchor="middle"
                    >
                      {openingNames[opening.kind]} · {opening.width} m
                    </text>
                  )}
                </g>
              );
            })}
            {document.furniture.items.map((f, index) => (
              <g
                key={index}
                role="button"
                aria-label={`选择家具 ${f.name || furnitureNames[f.kind]} ${index + 1}`}
                tabIndex={tool === "furniture" ? 0 : -1}
                onKeyDown={(e) => {
                  if (e.key === "Enter") select("furniture", index);
                }}
                transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`}
                onPointerDown={
                  tool === "furniture"
                    ? (e) => begin(e, { type: "furniture", index })
                    : undefined
                }
                style={{
                  pointerEvents: tool === "furniture" ? "auto" : "none",
                  cursor: "grab",
                  opacity: tool === "furniture" ? 1 : 0.55,
                }}
              >
                <rect
                  x={-f.width / 2}
                  y={-f.depth / 2}
                  width={f.width}
                  height={f.depth}
                  rx=".045"
                  fill={
                    active("furniture", index)
                      ? "#acd9bd"
                      : f.kind === "rug"
                        ? "#c7bc9f"
                        : "#d0b792"
                  }
                  fillOpacity={f.kind === "rug" ? 0.5 : 1}
                  stroke={active("furniture", index) ? "#297957" : "#907c5e"}
                  strokeWidth={active("furniture", index) ? 0.04 : 0.018}
                  strokeDasharray={f.kind === "rug" ? ".06 .04" : undefined}
                />
                <line
                  x1={-f.width * 0.32}
                  y1={-f.depth * 0.34}
                  x2={f.width * 0.32}
                  y2={-f.depth * 0.34}
                  stroke="#6e79676b"
                  strokeWidth=".025"
                />
                <text
                  className="furniture-plan-label"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={Math.min(0.16, f.width / 3.5, f.depth / 2.5)}
                >
                  {f.name || furnitureNames[f.kind]}
                </text>
              </g>
            ))}
            {(document.layout.lights || []).map((light, index) => (
              <g
                key={light.id}
                role="button"
                aria-label={`选择灯具 ${light.name}`}
                tabIndex={tool === "lights" ? 0 : -1}
                onKeyDown={(e) => {
                  if (e.key === "Enter") select("lights", index);
                }}
                onPointerDown={
                  tool === "lights" && !drawing
                    ? (e) => begin(e, { type: "lights", index })
                    : undefined
                }
                style={{
                  pointerEvents:
                    tool === "lights" && !drawing ? "auto" : "none",
                  cursor: "grab",
                }}
              >
                <circle
                  cx={light.x}
                  cy={light.y}
                  r=".2"
                  fill={
                    light.enabled ? lightColors[light.temperature] : "#abb0a4"
                  }
                  stroke={active("lights", index) ? "#297957" : "#ac8542"}
                  strokeWidth=".035"
                />
                <text
                  x={light.x}
                  y={light.y + 0.055}
                  textAnchor="middle"
                  fontSize=".18"
                  fill="#77591e"
                  pointerEvents="none"
                >
                  ☀
                </text>
                <text
                  x={light.x}
                  y={light.y - 0.28}
                  className="dimension-label"
                  textAnchor="middle"
                >
                  {light.name}
                </text>
              </g>
            ))}
            {item &&
              selected.type === "walls" &&
              ["start", "end"].map((key) => (
                <g key={key}>
                  <circle
                    cx={item[key].x}
                    cy={item[key].y}
                    r=".09"
                    fill="#fff"
                    stroke="#297957"
                    strokeWidth=".035"
                    className="plan-handle"
                    onPointerDown={(e) => begin(e, selected, key)}
                    aria-label={`拖动墙体${key === "start" ? "起点" : "终点"}`}
                  />
                  <text
                    x={item[key].x + 0.13}
                    y={item[key].y - 0.13}
                    className="dimension-label"
                  >
                    {key === "start" ? "起点" : "终点"}
                  </text>
                </g>
              ))}
            {item &&
              ["rooms", "outline"].includes(selected.type) &&
              item.polygon.map((p, index) => (
                <g key={index}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r=".09"
                    fill="#fff"
                    stroke="#297957"
                    strokeWidth=".035"
                    className="plan-handle"
                    onPointerDown={(e) => begin(e, selected, index)}
                    aria-label={`拖动${selected.type === "outline" ? "轮廓" : "地板"}角点 ${index + 1}`}
                  />
                  <text
                    x={p.x + 0.13}
                    y={p.y - 0.1}
                    className="dimension-label"
                  >
                    {index + 1}
                  </text>
                </g>
              ))}
            {tool === "furniture" && item && !drawing && (
              <g
                transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`}
              >
                <line
                  y1={-item.depth / 2}
                  y2={-item.depth / 2 - 0.38}
                  stroke="#297957"
                  strokeWidth=".025"
                  pointerEvents="none"
                />
                <circle
                  cy={-item.depth / 2 - 0.38}
                  r=".17"
                  fill="#297957"
                  stroke="#fff"
                  strokeWidth=".03"
                  pointerEvents="none"
                />
                <circle
                  cy={-item.depth / 2 - 0.38}
                  r=".34"
                  fill="transparent"
                  className="rotation-handle"
                  role="button"
                  tabIndex={0}
                  aria-label="拖动旋转家具"
                  onPointerDown={(e) => begin(e, selected, "rotate")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      rotate(item.rotation + 15);
                    }
                  }}
                />
                <text
                  y={-item.depth / 2 - 0.38}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#fff"
                  fontSize=".19"
                  pointerEvents="none"
                >
                  ↻
                </text>
                <text
                  y={-item.depth / 2 - 0.64}
                  textAnchor="middle"
                  className="dimension-label"
                  transform={`rotate(${-item.rotation} 0 ${-item.depth / 2 - 0.64})`}
                >
                  {normalizeRotation(item.rotation)}°
                </text>
              </g>
            )}
            {drawing && (
              <g pointerEvents="none">
                <polyline
                  points={drawing.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="#db8736"
                  strokeWidth=".05"
                />
                {drawing.points.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r=".07" fill="#db8736" />
                    <text
                      x={p.x + 0.1}
                      y={p.y - 0.1}
                      className="dimension-label"
                    >
                      {i + 1}
                    </text>
                  </g>
                ))}
              </g>
            )}
          </svg>
          <div className="plan-zoom">
            <button
              aria-label="缩小平面图"
              onClick={() => setZoom((z) => Math.max(0.65, z / 1.2))}
            >
              <Minus size={15} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              aria-label="放大平面图"
              onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
            >
              <Plus size={15} />
            </button>
            <button
              aria-label="适配平面图"
              onClick={() => {
                setFocusPoint(null);
                setZoom(1);
              }}
            >
              <Focus size={15} />
            </button>
          </div>
          <div className="plan-legend">
            <span>
              <i />
              墙体
            </span>
            <span>
              <i className="window" />
              窗户
            </span>
            <span>
              <i className="passage" />
              开放通道
            </span>
            <span>方向键微移 · Shift 加速</span>
          </div>
        </section>
        <aside className="edit-properties edit-inspector" aria-label="对象属性">
          <div className="inspector-heading">
            <span>对象属性</span>
            <strong>{selectedName}</strong>
            <small>
              {item ? "修改即时反映在平面图" : "从对象库或平面图选择对象"}
            </small>
          </div>
          <fieldset disabled={busy || !!drawing}>
            {item && (
              <div
                className="edit-section"
                key={`${selected.type}-${selected.index}-${item.id || item.kind || ""}`}
              >
                {selected.type === "lights" && (
                  <>
                    <label className="edit-label">
                      灯具名称
                      <input
                        aria-label="灯具名称"
                        maxLength={60}
                        value={item.name}
                        onChange={(e) =>
                          patch((_, target) => {
                            target.name = e.target.value;
                          })
                        }
                      />
                    </label>
                    <label className="edit-label">
                      灯具类型
                      <select
                        aria-label="灯具类型"
                        value={item.kind}
                        onChange={(e) =>
                          patch((_, target) => {
                            target.kind = e.target.value;
                          })
                        }
                      >
                        {Object.entries(lightNames).map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="edit-number-grid">
                      {number("左右位置", "x", -60, 60)}
                      {number("上下位置", "y", -60, 60)}
                      {number("发光点高度", "elevation", 0.3, 4.5)}
                      {number("灯具亮度", "lumens", 0, 3000, "lm")}
                    </div>
                    <label className="edit-label">
                      灯光色温
                      <select
                        aria-label="灯光色温"
                        value={item.temperature}
                        onChange={(e) =>
                          patch((_, target) => {
                            target.temperature = Number(e.target.value);
                          })
                        }
                      >
                        <option value={2700}>2700K 暖黄光</option>
                        <option value={3000}>3000K 暖白光</option>
                        <option value={4000}>4000K 自然光</option>
                        <option value={6500}>6500K 冷白光</option>
                      </select>
                    </label>
                    <label className="edit-label">
                      灯具开关
                      <select
                        aria-label="灯具开关"
                        value={item.enabled ? "on" : "off"}
                        onChange={(e) =>
                          patch((_, target) => {
                            target.enabled = e.target.value === "on";
                          })
                        }
                      >
                        <option value="on">夜晚开启</option>
                        <option value="off">关闭</option>
                      </select>
                    </label>
                    <p className="field-note">
                      白天关闭人工灯光；夜晚按已保存的开关、亮度和色温照明。
                    </p>
                  </>
                )}
                {selected.type === "furniture" && (
                  <>
                    <RotationControl value={item.rotation} onChange={rotate} />
                    <h3 className="property-group-title">位置与尺寸</h3>
                    <div className="edit-number-grid">
                      {number("左右位置", "x", -60, 60)}
                      {number("上下位置", "y", -60, 60)}
                      {number("家具宽度", "width", 0.1, 6)}
                      {number("家具进深", "depth", 0.1, 6)}
                      {number("家具高度", "height", 0.02, 3)}
                    </div>
                    <p className="field-note">
                      坐标为家具中心，尺寸为旋转前的本体尺寸。跨空间移动后自动匹配能完整容纳家具的空间。
                    </p>
                    <details className="edit-vertices">
                      <summary>名称、类型与所属空间</summary>
                      <label className="edit-label">
                        家具名称
                        <input
                          aria-label="家具名称"
                          value={item.name || ""}
                          maxLength={60}
                          placeholder={furnitureNames[item.kind]}
                          onChange={(e) =>
                            patch((_, target) => {
                              target.name = e.target.value;
                            })
                          }
                        />
                      </label>
                      <label className="edit-label">
                        家具类型
                        <select
                          aria-label="家具类型"
                          value={item.kind}
                          onChange={(e) =>
                            patch((_, target) => {
                              target.kind = e.target.value;
                            })
                          }
                        >
                          {Object.entries(furnitureNames).map(([id, name]) => (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="edit-label">
                        所属空间
                        <select
                          value={item.room_id}
                          onChange={(e) =>
                            patch((_, target) => {
                              target.room_id = e.target.value;
                            })
                          }
                        >
                          {document.layout.rooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </details>
                  </>
                )}
                {selected.type === "walls" && (
                  <>
                    <label className="edit-label">
                      墙体类型
                      <select
                        aria-label="墙体类型"
                        value={item.exterior ? "exterior" : "interior"}
                        onChange={(e) =>
                          patch((_, target) => {
                            target.exterior = e.target.value === "exterior";
                          })
                        }
                      >
                        <option value="interior">隔墙</option>
                        <option value="exterior">外墙</option>
                      </select>
                    </label>
                    <div className="edit-number-grid">
                      {number("墙体厚度", "thickness", 0.06, 0.6)}
                      {number("墙体高度", "height", 1.8, 4.5)}
                      {["start", "end"].flatMap((key) =>
                        ["x", "y"].map((axis) => (
                          <NumberField
                            key={key + axis}
                            label={`${key === "start" ? "起点" : "终点"} ${axis.toUpperCase()}`}
                            value={item[key][axis]}
                            onCommit={(value) =>
                              changeWallPoint(key, axis, value)
                            }
                          />
                        )),
                      )}
                    </div>
                    <p className="field-note">
                      墙长 {wallLength(item).toFixed(2)} m ·
                      拖动墙线会联动相连边界
                    </p>
                    <label className="edit-label">
                      墙面材质
                      <select
                        value={item.finish || "default"}
                        onChange={(e) =>
                          patch((_, target) => {
                            target.finish = e.target.value;
                          })
                        }
                      >
                        {Object.entries(wallFinishes).map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="field-note">
                      附着对象：门窗在「门窗」页管理，开放通道在「通道」页管理。
                    </p>
                    <div className="edit-opening-add">
                      {Object.entries({
                        door: "添加门",
                        window: "添加窗户",
                      }).map(([kind, name]) => (
                        <button
                          key={kind}
                          disabled={!document.layout.walls.length}
                          onClick={() => addOpening(kind)}
                        >
                          <Plus size={12} />
                          {name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {selected.type === "rooms" && (
                  <>
                    <label className="edit-label">
                      地板铺设
                      <select
                        aria-label="地板铺设"
                        value={item.floor_enabled === false ? "off" : "on"}
                        onChange={(e) =>
                          patch((_, target) => {
                            target.floor_enabled = e.target.value === "on";
                          })
                        }
                      >
                        <option value="on">铺设地板</option>
                        <option value="off">移除地板，保留空间</option>
                      </select>
                    </label>
                    <label className="edit-label">
                      空间名称
                      <input
                        aria-label="空间名称"
                        value={item.name}
                        maxLength={60}
                        onChange={(e) =>
                          patch((_, target) => {
                            target.name = e.target.value;
                          })
                        }
                      />
                    </label>
                    <label className="edit-label">
                      空间用途
                      <select
                        value={item.kind}
                        onChange={(e) =>
                          patch((_, target) => {
                            target.kind = e.target.value;
                          })
                        }
                      >
                        {Object.entries(roomNames).map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="edit-label">
                      地板材质
                      <select
                        aria-label="地板材质"
                        value={item.floor_finish || "default"}
                        onChange={(e) =>
                          patch((_, target) => {
                            target.floor_finish = e.target.value;
                          })
                        }
                      >
                        {Object.entries(floorFinishes).map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="field-note">
                      当前地板面积 {polygonArea(item.polygon).toFixed(2)}{" "}
                      ㎡。拖动圆点调整范围；地板单独调整不会移动墙体。
                    </p>
                    <PolygonFields
                      points={item.polygon}
                      onChange={(points) =>
                        patch((_, target) => {
                          target.polygon = points;
                        })
                      }
                    />
                    <details className="edit-vertices">
                      <summary>拆分空间</summary>
                      <p className="field-note">
                        按坐标切成两个空间，家具自动归属。拆分不添加墙体。
                      </p>
                      <label className="edit-label">
                        拆分方向
                        <select
                          aria-label="拆分方向"
                          value={splitAxis}
                          onChange={(e) => setSplitAxis(e.target.value)}
                        >
                          <option value="x">左右拆分（X 坐标）</option>
                          <option value="y">上下拆分（Y 坐标）</option>
                        </select>
                      </label>
                      <NumberField
                        label="拆分坐标"
                        value={splitAt}
                        onCommit={setSplitAt}
                      />
                      <button
                        className="secondary-button full-width"
                        onClick={() => {
                          try {
                            const next = splitRoom(
                              draft.document,
                              selected.index,
                              splitAxis,
                              splitAt,
                              `room_${crypto.randomUUID().slice(0, 12)}`,
                            );
                            draft.commit(next);
                            setError("");
                          } catch (e) {
                            setError(e.message);
                          }
                        }}
                      >
                        拆分为两个空间
                      </button>
                    </details>
                  </>
                )}
                {selected.type === "outline" && (
                  <>
                    <p className="field-note">
                      轮廓决定建筑基座范围，至少保留三个角点；室内对象单独编辑。
                    </p>
                    <PolygonFields
                      points={item.polygon}
                      max={40}
                      onChange={(points) =>
                        patch((next) => {
                          next.layout.outline = points;
                        })
                      }
                    />
                    <button
                      className="secondary-button full-width"
                      onClick={() => startDrawing("outline")}
                    >
                      重新绘制户型轮廓
                    </button>
                  </>
                )}
                {selected.type === "openings" && (
                  <>
                    <label className="edit-label">
                      类型
                      <select
                        value={item.kind}
                        onChange={(e) =>
                          patch((_, target) => {
                            target.kind = e.target.value;
                            if (target.kind !== "window") target.bottom = 0;
                          })
                        }
                      >
                        {Object.entries(openingChoices).map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="edit-label">
                      所在墙体
                      <select
                        value={item.wall_id}
                        onChange={(e) =>
                          patch((next, target) => {
                            target.wall_id = e.target.value;
                            target.offset = 0;
                          })
                        }
                      >
                        {document.layout.walls.map((w, index) => (
                          <option value={w.id} key={w.id}>
                            {labelFor(w, "walls", index)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="edit-number-grid">
                      {number(
                        "距墙起点",
                        "offset",
                        0,
                        wall ? wallLength(wall) : 60,
                      )}
                      {number("开口宽度", "width", 0.1, 60)}
                      {number("开口高度", "height", 0.1, 4.5)}
                      {item.kind === "window" &&
                        number("窗台离地", "bottom", 0, 3)}
                    </div>
                    {item.kind === "door" && (
                      <>
                        <label className="edit-label">
                          门扇
                          <select
                            aria-label="门扇"
                            value={item.door_leaf === false ? "off" : "on"}
                            onChange={(e) =>
                              patch((_, target) => {
                                target.door_leaf = e.target.value === "on";
                              })
                            }
                          >
                            <option value="on">安装门扇</option>
                            <option value="off">仅保留门洞</option>
                          </select>
                        </label>
                        {item.door_leaf !== false && (
                          <>
                            <label className="edit-label">
                              铰链位置
                              <select
                                aria-label="铰链位置"
                                value={item.hinge || "start"}
                                onChange={(e) =>
                                  patch((_, target) => {
                                    target.hinge = e.target.value;
                                  })
                                }
                              >
                                <option value="start">靠墙起点侧</option>
                                <option value="end">靠墙终点侧</option>
                              </select>
                            </label>
                            <label className="edit-label">
                              开启方向
                              <select
                                aria-label="开启方向"
                                value={item.swing || "left"}
                                onChange={(e) =>
                                  patch((_, target) => {
                                    target.swing = e.target.value;
                                  })
                                }
                              >
                                <option value="left">逆时针</option>
                                <option value="right">顺时针</option>
                              </select>
                            </label>
                            <NumberField
                              label="开启角度"
                              min={0}
                              max={110}
                              unit="°"
                              value={item.angle ?? 90}
                              onCommit={(v) =>
                                patch((_, target) => {
                                  target.angle = v;
                                })
                              }
                            />
                          </>
                        )}
                      </>
                    )}
                    <p className="field-note">
                      {item.kind === "passage"
                        ? "开放通道只开洞，不安装窗框或门扇。"
                        : "门窗会跟随所在墙体一起移动。"}
                    </p>
                  </>
                )}
                {selected.type !== "outline" && (
                  <>
                    <div className="nudge-pad">
                      <span>微移 {Math.round(step * 100)} cm</span>
                      <button
                        aria-label="向左微移"
                        onClick={() => move(-step, 0)}
                      >
                        <ArrowLeft size={14} />
                      </button>
                      <button
                        aria-label="向上微移"
                        onClick={() => move(0, -step)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        aria-label="向下微移"
                        onClick={() => move(0, step)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        aria-label="向右微移"
                        onClick={() => move(step, 0)}
                      >
                        <ArrowRight size={14} />
                      </button>
                    </div>
                    <div className="edit-delete-row">
                      {selected.type === "furniture" && (
                        <button
                          onClick={() => {
                            if (document.furniture.items.length >= 90) return;
                            const next = clone(document);
                            next.furniture.items.push({
                              ...item,
                              x: round(item.x + step),
                              y: round(item.y + step),
                            });
                            draft.commit(next);
                            select(
                              "furniture",
                              next.furniture.items.length - 1,
                            );
                          }}
                        >
                          <Copy size={12} />
                          复制家具
                        </button>
                      )}
                      <button onClick={remove}>
                        <Trash2 size={12} />
                        {selected.type === "walls"
                          ? "删除墙体及附着对象"
                          : selected.type === "rooms"
                            ? "删除空间及地板"
                            : "删除选中对象"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </fieldset>
        </aside>
      </div>
      {pendingDelete && (
        <div className="edit-delete-confirm" role="alert">
          <div>
            <strong>删除{selectedName}？</strong>
            <p>
              {pendingDelete.type === "walls"
                ? `将同时删除 ${document.layout.openings.filter((o) => o.wall_id === item?.id).length} 个附着的门、窗户或通道。`
                : pendingDelete.type === "rooms"
                  ? `将删除该空间及地板；关联 ${document.furniture.items.filter((f) => f.room_id === item?.id).length} 件家具。`
                  : "删除后可通过撤销恢复。"}
            </p>
            {pendingDelete.type === "rooms" && (
              <label>
                <input
                  type="checkbox"
                  checked={deleteFurniture}
                  onChange={(e) => setDeleteFurniture(e.target.checked)}
                />
                同时删除该空间的家具（否则尝试归入其他空间）
              </label>
            )}
          </div>
          <button disabled={busy} onClick={confirmRemove}>
            确认删除
          </button>
          <button disabled={busy} onClick={() => setPendingDelete(null)}>
            取消
          </button>
        </div>
      )}
      {(issues.length > 0 || error || draft.storageError) && (
        <div className="edit-issues" role="alert">
          <AlertTriangle size={16} />
          <div>
            {error && <p>{error}</p>}
            {draft.storageError && <p>{draft.storageError}</p>}
            {issues.slice(0, 5).map((issue, index) => (
              <button
                key={index}
                onClick={() => select(issue.type, issue.index)}
              >
                {issue.text} <span>定位 ↗</span>
              </button>
            ))}
            {issues.length > 5 && (
              <p>另有 {issues.length - 5} 处问题，调整后会继续提示。</p>
            )}
          </div>
        </div>
      )}
      <div className="edit-save-bar">
        <div>
          <span>
            <Check size={13} />
            {draft.storageError ? "草稿暂未保存" : "草稿按任务自动保存"}
          </span>
          <small>拖动或输入尺寸 → 检查布局 → 保存新的三维版本</small>
        </div>
        <label>
          版本名称
          <input
            aria-label="设计版本名称"
            value={name}
            maxLength={120}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="primary-button"
          disabled={
            busy ||
            !!issues.length ||
            !name.trim() ||
            !!drawing ||
            !!pendingDelete
          }
          onClick={save}
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Save size={15} />
          )}
          保存并生成三维
        </button>
      </div>
    </div>
  );
}
