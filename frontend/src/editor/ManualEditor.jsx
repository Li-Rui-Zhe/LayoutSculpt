import "./editorWorkspace.css";
import PlanReferenceTools from "./PlanReferenceTools.jsx";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Armchair,
  Lightbulb,
  SquareDashed,
  BrickWall,
  DoorOpen,
  Route,
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
  Hand,
  Sparkles,
} from "lucide-react";
import { wallSides, calibrate, snapFurniture } from "./designTools.js";
import { batchFurniture } from "./batch.js";
import LivePreview from "./LivePreview.jsx";
import SceneStructureForm from "./SceneStructureForm.jsx";
import { applySceneEdit } from "./sceneEdits.js";
import { lockedChange } from "./objectIdentity.js";
import LocalReview from "./LocalReview.jsx";
import {
  readContext,
  writeContext,
  useUrlContext,
} from "../hooks/urlContext.js";
import { LiveParameterContext } from "./LiveParameterContext.js";
import { UnitContext } from "./UnitContext.js";
import WallElevation from "./WallElevation.jsx";
import LightGroupControls from "./LightGroupControls.jsx";
import FloorTiling from "./FloorTiling.jsx";
import NumberField from "./NumberField.jsx";
const DiyStudio = lazy(() => import("../diy/DiyStudio.jsx"));
import SurfaceFinishPicker from "./SurfaceFinishPicker.jsx";
import SurfaceTransfer from "./SurfaceTransfer.jsx";
import AssetLibrary from "../library/AssetLibrary.jsx";
import {
  placeLibraryFurniture,
  validateFurnitureTemplate,
  furniturePlacementAt,
  commitFurniturePlacement,
} from "../library/placement.js";
import { updatePlacedDesign, placedDesign } from "../diy/design.js";
import OpeningComposer from "./OpeningComposer.jsx";
import { validateOpening } from "./openingPlacement.js";
import RotationControl from "./RotationControl.jsx";
import { showerKinds, showerProblems } from "./showerPlacement.js";
import PolygonFields from "./PolygonFields.jsx";
import { useDesignCheck } from "./useDesignCheck.js";
import { useEditDraft } from "./useEditDraft.js";
import { materials, materialCategories } from "../catalog.js";
import { applySurfaceDraft, floorColor } from "../materials/assignments.js";
import { resolveMaterial } from "../materials/custom.js";
import { usePlanNavigation } from "./usePlanNavigation.js";
import { deriveOutline, fitOutline, sameArchitecture } from "./autoOutline.js";
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
  problems,
  furnitureNames,
  furnitureCorners,
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
  overlapArea,
  doorLeafPoints,
} from "./geometry.js";

const tools = [
  ["furniture", Armchair, "家具"],
  ["walls", BrickWall, "墙体"],
  ["rooms", SquareDashed, "地板 / 空间"],
  ["openings", DoorOpen, "门窗"],
  ["passages", Route, "通道"],
  ["lights", Lightbulb, "灯具"],
];
const hints = {
  lights:
    "支持灯泡、吊灯、落地灯、吸顶灯、筒灯和台灯，可调整位置、高度、亮度、色温及灯组。三维切换夜晚查看效果。",
  furniture: "拖动家具移动，拖动绿色手柄旋转；右侧精确调整位置、尺寸和角度。",
  walls:
    "拖动墙线移动整面墙，拖两端圆点调整长度；相连墙角与邻近地板角点会联动，户型轮廓自动适配。",
  rooms:
    "拖动空间整体或角点；右侧可新增、拆分、删除空间。户型轮廓随墙体与空间自动适配，无需单独调整。",
  openings: "门和窗户沿墙拖动；可调整尺寸、窗台及门扇开启方式。",
  passages:
    "独立管理无门扇的开放通道，沿墙调整位置和宽高。走廊区域可在地板 / 空间中绘制。",
};
const floorColors = {
  default: "#e3d6b8",
  oak: "#dbc395",
  walnut: "#96785e",
  tile: "#e3e4dc",
  stone: "#b1bbbc",
};
function objects(doc, type) {
  return type === "furniture" ? doc.furniture.items : doc.layout[type];
}
function labelFor(item, type, index) {
  return type === "furniture"
    ? item.name || `${furnitureNames[item.kind]} ${index + 1}`
    : type === "lights"
      ? item.name
      : type === "walls"
        ? `墙体 ${index + 1}${item.exterior ? " · 外墙" : " · 隔墙"}`
        : type === "rooms"
          ? item.name
          : `${openingNames[item.kind]} ${index + 1}`;
}

export default function ManualEditor({
  job,
  active: isActive,
  projects,
  onClose,
  placementRequest,
  onPlacementConsumed,
  floorRequest,
  onFloorConsumed,
  designMode = null,
  onDesignModeChange,
}) {
  const [sidebarTab, setSidebarTab] = useState("objects");
  const [focusCanvas, setFocusCanvas] = useState(false);
  const [displayUnit, setDisplayUnit] = useState("m");
  const [multi, setMulti] = useState([]);
  const [hideFurniture, setHideFurniture] = useState(false);
  const [measureMode, setMeasureMode] = useState(false),
    [measure, setMeasure] = useState([]);
  const [boxMode, setBoxMode] = useState(false),
    [selectionBox, setSelectionBox] = useState(null);
  const marquee = useRef(null);
  const [snap, setSnap] = useState(true),
    [actualLength, setActualLength] = useState(1);
  const [overlay, setOverlay] = useState(false),
    [opacity, setOpacity] = useState(0.35);
  const [registration, setRegistration] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(`plan-registration:${job.id}`)) || {
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
        }
      );
    } catch {
      return { x: 0, y: 0, scale: 1, rotation: 0 };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        `plan-registration:${job.id}`,
        JSON.stringify(registration),
      );
    } catch {}
  }, [job.id, registration]);

  const [editorView, setEditorView] = useUrlContext(
    "editorView",
    "plan",
    isActive,
  );
  const isScene = editorView === "scene";
  const [libraryOpen, setLibraryOpen] = useState(false);
  const consumedPlacement = useRef(null);
  const [placement, setPlacement] = useState(null);
  const placementCommitted = useRef(false);
  const placementPointer = useRef(null);
  const rotationDrag = useRef(null);
  useEffect(() => {
    setPlacement(null);
  }, [editorView, isActive, job.id, designMode]);

  const [diyOpen, setDiyOpen] = useState(null);
  const reviewing = job.status === "awaiting_review";
  const draft = useEditDraft(job.id, reviewing);
  const locked = draft.document
    ? ["furniture", "walls", "rooms", "openings", "lights"].flatMap((type) =>
        objects(draft.document, type).flatMap((item, index) =>
          item.edit_locked ? [`${type}:${index}`] : [],
        ),
      )
    : [];
  const toggleLock = () =>
    draft.commit((next) => {
      const value = objects(next, selected.type)[selected.index];
      value.edit_locked = !value.edit_locked;
      return next;
    }, false);
  const consumedFloor = useRef(null);
  useEffect(() => {
    if (
      !floorRequest ||
      !draft.document ||
      consumedFloor.current === floorRequest.id
    )
      return;
    consumedFloor.current = floorRequest.id;
    draft.commit(
      applySurfaceDraft(
        draft.document,
        floorRequest.state,
        draft.base?.layout.rooms,
      ),
      false,
    );
    setTool(floorRequest.state.category === "walls" ? "walls" : "rooms");
    const index = draft.document.layout.rooms.findIndex(
      (r) => r.id === floorRequest.state.floorTarget,
    );
    setSelected({
      type: floorRequest.state.category === "walls" ? "walls" : "rooms",
      index: floorRequest.state.category === "walls" ? 0 : Math.max(0, index),
    });
    onFloorConsumed?.();
  }, [floorRequest, draft.document, onFloorConsumed]);
  const initialTool =
    designMode === "floor"
      ? "rooms"
      : designMode === "walls" || reviewing
        ? "walls"
        : "furniture";
  const [tool, setTool] = useState(initialTool),
    [selected, setSelected] = useState({
      type: initialTool,
      index: 0,
    });
  useEffect(() => {
    if (tool !== "furniture") setPlacement(null);
  }, [tool]);
  const linkedObject = useRef(readContext("object"));
  useEffect(() => {
    if (!draft.document) return;
    if (linkedObject.current) {
      const [type, id] = linkedObject.current.split(":");
      linkedObject.current = "";
      if (
        ["rooms", "walls", "furniture", "openings", "lights"].includes(type)
      ) {
        const index = objects(draft.document, type).findIndex(
          (o) => (o.edit_id || o.id) === id,
        );
        if (index >= 0) {
          setSelected({ type, index });
          setTool(toolFor(type, objects(draft.document, type)[index]));
          return;
        }
      }
    }
    if (isActive) {
      const item =
        selected && objects(draft.document, selected.type)[selected.index];
      writeContext({
        object: item ? `${selected.type}:${item.edit_id || item.id}` : null,
      });
    }
  }, [draft.document, selected, isActive]);
  useEffect(() => {
    if (!designMode) return;
    const type = designMode === "walls" ? "walls" : "rooms";
    setTool(type);
    setSelected({ type, index: 0 });
    setDrawing(null);
    setPendingDelete(null);
    setOpeningKind(null);
    setOpeningPreview(null);
    setOpeningAnchor(null);
  }, [designMode]);
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => setAcknowledged(false), [draft.document]);
  const saveLock = useRef(false);
  const [preview, setPreview] = useState(null),
    [step, setStep] = useState(0.1);
  const nameEdited = useRef(false);
  const nextVersion =
    Math.max(
      job.version || 1,
      ...(
        projects.groups?.find((g) => g.id === job.projectId)?.versions || []
      ).map((j) => j.version || 1),
    ) + 1;
  const suggestedName = `${job.name
    .replace(/(?: · 设计)+$/, "")
    .replace(/ · V\d+$/, "")
    .replace(/\.(png|jpe?g|webp)$/i, "")} · V${nextVersion}`.slice(0, 120);
  const [name, setName] = useState(suggestedName);
  useEffect(() => {
    if (!nameEdited.current) setName(suggestedName);
  }, [suggestedName]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [furnitureKind, setFurnitureKind] = useState("chair");
  const [lightKind, setLightKind] = useState("bulb");
  const [wallSide, setWallSide] = useState("both");
  const [query, setQuery] = useState("");
  useEffect(() => {
    setQuery("");
    setMulti([]);
  }, [tool]);
  const [wallId, setWallId] = useState("");
  const [pickingWall, setPickingWall] = useState(false);
  const [openingKind, setOpeningKind] = useState(null);
  const [openingSequence, setOpeningSequence] = useState(0);
  const [openingPreview, setOpeningPreview] = useState(null);
  const [openingAnchor, setOpeningAnchor] = useState(null);
  const cancelOpening = () => {
    setOpeningKind(null);
    setOpeningPreview(null);
    setOpeningAnchor(null);
  };
  const [validationOpen, setValidationOpen] = useState(false);
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
      sceneDrag.current = null;
      rotationDrag.current = null;
      setPreview(null);
    }
  }, [isActive]);
  useEffect(() => {
    drag.current = null;
    sceneDrag.current = null;
    rotationDrag.current = null;
    marquee.current = null;
    setPreview(null);
    setDrawing(null);
    setPendingDelete(null);
    setMeasureMode(false);
    setBoxMode(false);
    setSelectionBox(null);
    setMulti([]);
    setPickingWall(false);
    setOpeningKind(null);
    setOpeningPreview(null);
    setError("");
  }, [editorView]);
  const svg = useRef(null),
    drag = useRef(null),
    sceneDrag = useRef(null),
    lastNavigationClick = useRef(false),
    root = useRef(null);
  const navigation = usePlanNavigation(
    svg,
    draft.document ? bounds(draft.document.layout) : null,
    isActive && !isScene,
    () => !drag.current,
  );
  const { zoom, focusPoint } = navigation;
  const document = preview || draft.document;
  const selectedObject =
    document && selected
      ? objects(document, selected.type)[selected.index]
      : null;
  const item =
    selectedObject && toolFor(selected.type, selectedObject) === tool
      ? selectedObject
      : null;
  const outlineIssue = useMemo(() => {
    if (
      !document ||
      !draft.base ||
      sameArchitecture(document.layout, draft.base.layout)
    )
      return null;
    return deriveOutline(document.layout).issue;
  }, [document, draft.base]);
  const issues = document
    ? [
        ...(outlineIssue ? [outlineIssue] : []),
        ...problems(document),
        ...showerProblems(document),
      ]
    : [];
  const serverCheck = useDesignCheck(
    draft.document,
    isActive && !reviewing && !issues.length,
  );
  const openingTool = ["openings", "passages"].includes(tool);
  const targetWallId = document?.layout.walls.some((wall) => wall.id === wallId)
    ? wallId
    : document?.layout.walls[0]?.id || "";
  const hasFeedback = !!(
    issues.length ||
    serverCheck.issues.length ||
    error ||
    draft.storageError
  );
  useEffect(() => {
    setPickingWall(false);
  }, [tool]);
  useEffect(() => {
    if (error || draft.storageError) setValidationOpen(true);
    else if (!issues.length) setValidationOpen(false);
  }, [error, draft.storageError, issues.length]);
  useEffect(() => {
    if (!isActive || !validationOpen) return;
    const close = (event) => {
      if (event.key === "Escape") setValidationOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [isActive, validationOpen]);
  const select = (type, index, object) => {
    setSidebarTab("objects");
    setPlacement(null);
    cancelOpening();
    if (type === "outline") {
      setTool("walls");
      setSelected(null);
      navigation.reset();
      return;
    }
    const value = object || objects(document, type)[index];
    setTool(toolFor(type, value));
    setSelected({ type, index });
    if (type === "walls" && value) setWallId(value.id);
    if (type === "openings" && value) setWallId(value.wall_id);
    setError("");
  };
  const chooseOpeningWall = (id, point) => {
    setWallId(id);
    setSelected(null);
    setPickingWall(false);
    setError("");
    if (openingKind && point) {
      const wall = document.layout.walls.find((wall) => wall.id === id);
      const length = wallLength(wall);
      setOpeningAnchor({
        wallId: id,
        offset: length
          ? ((point.x - wall.start.x) * (wall.end.x - wall.start.x) +
              (point.y - wall.start.y) * (wall.end.y - wall.start.y)) /
            length
          : 0,
      });
    } else setOpeningAnchor(null);
  };
  const commitParameter = (next) => {
    if (busy || drawing || sceneDrag.current) return false;
    const fitted = fitOutline(draft.document, next);
    const previousIssues = new Set(
      problems(draft.document).map((p) => `${p.type}:${p.index}:${p.text}`),
    );
    const issue =
      isScene &&
      problems(fitted).find(
        (p) => !previousIssues.has(`${p.type}:${p.index}:${p.text}`),
      );
    const message = lockedChange(draft.document, fitted) || issue?.text;
    if (message) {
      setError(message);
      return message;
    }
    draft.commit(fitted);
    setError("");
    return true;
  };
  const patch = (change) => {
    if (busy || !item || locked.includes(`${selected.type}:${selected.index}`))
      return false;
    const next = clone(draft.document);
    change(next, objects(next, selected.type)[selected.index]);
    return commitParameter(next);
  };
  const rotate = (angle) => {
    if (
      busy ||
      drawing ||
      !item ||
      selected.type !== "furniture" ||
      locked.includes(`${selected.type}:${selected.index}`)
    )
      return;
    return commitParameter(
      rotateFurniture(draft.document, selected.index, angle),
    );
  };
  const previewRotation = (angle) => {
    if (
      busy ||
      drawing ||
      placement ||
      sceneDrag.current ||
      !item ||
      selected?.type !== "furniture" ||
      item.edit_locked
    )
      return;
    rotationDrag.current ||= {
      document: draft.document,
      index: selected.index,
    };
    const gesture = rotationDrag.current;
    if (
      gesture.document !== draft.document ||
      gesture.index !== selected.index
    ) {
      rotationDrag.current = null;
      setPreview(null);
      return;
    }
    setPreview(rotateFurniture(gesture.document, gesture.index, angle));
  };
  const cancelRotation = () => {
    rotationDrag.current = null;
    setPreview(null);
  };
  const finishRotation = (angle) => {
    const gesture = rotationDrag.current;
    cancelRotation();
    if (
      !gesture ||
      gesture.document !== draft.document ||
      gesture.index !== selected?.index
    )
      return;
    if (
      normalizeRotation(angle) !==
      normalizeRotation(
        gesture.document.furniture.items[gesture.index].rotation,
      )
    )
      rotate(angle);
  };
  const move = (dx, dy) => {
    if (
      item &&
      !busy &&
      !drawing &&
      !locked.includes(`${selected.type}:${selected.index}`)
    )
      draft.commit(
        selected.type === "furniture" && multi.length > 1
          ? batchFurniture(
              draft.document,
              multi.filter((i) => !locked.includes(`furniture:${i}`)),
              "move",
              { x: dx, y: dy },
            )
          : moveSelection(draft.document, selected, dx, dy),
      );
  };
  useEffect(() => {
    const keyboard = (event) => {
      if (
        !isActive ||
        !!diyOpen ||
        busy ||
        !draft.document ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
      )
        return;
      if (placement) {
        if (event.key === "Escape") {
          event.preventDefault();
          setPlacement(null);
          return;
        }
        if (
          event.key.toLowerCase() === "r" &&
          !event.ctrlKey &&
          !event.metaKey &&
          placement.template.kind !== "wall_television"
        ) {
          event.preventDefault();
          setPlacement((p) => p && { ...p, rotation: (p.rotation + 90) % 360 });
          return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        setPlacement(null);
        event.preventDefault();
        drag.current = null;
        sceneDrag.current = null;
        setPreview(null);
        setDrawing(null);
        setPendingDelete(null);
        cancelOpening();
        setMulti([]);
        setSelected(null);
        event.shiftKey ? draft.redo() : draft.undo();
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [isActive, busy, draft, diyOpen, placement]);
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
    if (event.shiftKey && target.type === "furniture" && !handle) {
      setMulti((v) =>
        v.includes(target.index)
          ? v.filter((i) => i !== target.index)
          : [...v, target.index],
      );
      select(target.type, target.index);
      return;
    }
    if (locked.includes(`${target.type}:${target.index}`)) {
      select(target.type, target.index);
      return;
    }
    if (target.type === "furniture" && !multi.includes(target.index)) {
      const group = document.furniture.items[target.index].edit_group;
      setMulti(
        group
          ? document.furniture.items.flatMap((f, i) =>
              f.edit_group === group ? [i] : [],
            )
          : [target.index],
      );
    }
    lastNavigationClick.current = false;
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
    if (placement && !event.buttons) {
      movePlacement(pointAt(event));
      return;
    }
    if (marquee.current) {
      setSelectionBox({ ...marquee.current, end: pointAt(event) });
      return;
    }
    if (navigation.movePan(event)) return;
    if (!drag.current) return;
    const p = pointAt(event),
      start = drag.current.origin;
    const dx = round(Math.round((p.x - start.x) / step) * step),
      dy = round(Math.round((p.y - start.y) / step) * step);
    const current = drag.current;
    const next =
      current.target.type === "furniture" &&
      !current.handle &&
      multi.length > 1 &&
      multi.includes(current.target.index)
        ? batchFurniture(
            current.document,
            multi.filter((i) => !locked.includes(`furniture:${i}`)),
            "move",
            { x: dx, y: dy },
          )
        : current.handle === "rotate"
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
    const fitted = fitOutline(current.document, next);
    drag.current.latest = fitted;
    setPreview(fitted);
  };
  const end = (event, cancel = false) => {
    if (marquee.current) {
      const a = marquee.current.start,
        b = pointAt(event);
      marquee.current = null;
      setSelectionBox(null);
      if (svg.current.hasPointerCapture(event.pointerId))
        svg.current.releasePointerCapture(event.pointerId);
      if (!cancel)
        setMulti(
          document.furniture.items.flatMap((f, i) =>
            !f.edit_hidden &&
            f.x >= Math.min(a.x, b.x) &&
            f.x <= Math.max(a.x, b.x) &&
            f.y >= Math.min(a.y, b.y) &&
            f.y <= Math.max(a.y, b.y)
              ? [i]
              : [],
          ),
        );
      return;
    }
    if (navigation.finishPan(event, cancel)) return;
    const current = drag.current;
    drag.current = null;
    if (svg.current.hasPointerCapture(event.pointerId))
      svg.current.releasePointerCapture(event.pointerId);
    if (!cancel && current?.latest)
      draft.commit(
        snap &&
          current.target.type === "furniture" &&
          !current.handle &&
          multi.length < 2
          ? snapFurniture(current.latest, current.target.index)
          : current.latest,
      );
    setPreview(null);
  };
  const startPlacement = (template) => {
    validateFurnitureTemplate(draft.document, template);
    if (!draft.document.layout.rooms.length)
      throw Error("请先创建空间，再放置家具。");
    cancelOpening();
    setDrawing(null);
    setPendingDelete(null);
    navigation.setPanMode(false);
    setMeasureMode(false);
    setBoxMode(false);
    setHideFurniture(false);
    setSelected(null);
    setMulti([]);
    setTool("furniture");
    setPreview(null);
    placementCommitted.current = false;
    setPlacement({
      template: clone(template),
      point: null,
      rotation: template.rotation || 0,
      preferredRoomId:
        item?.room_id || (selected?.type === "rooms" ? item?.id : null),
    });
    setError("");
  };
  const movePlacement = (point) =>
    setPlacement((current) => (current ? { ...current, point } : null));
  const placementResult =
    placement?.point && draft.document
      ? furniturePlacementAt(
          draft.document,
          placement.template,
          placement.point,
          placement.rotation,
        )
      : null;
  const confirmPlacement = (point = placement?.point) => {
    if (!placement || !point || busy || placementCommitted.current) return;
    const result = furniturePlacementAt(
      draft.document,
      placement.template,
      point,
      placement.rotation,
    );
    movePlacement(point);
    if (!result.valid) return;
    const next = commitFurniturePlacement(
      draft.document,
      placement.template,
      point,
      placement.rotation,
    );
    placementCommitted.current = true;
    draft.commit(next);
    select(
      "furniture",
      next.furniture.items.length - 1,
      next.furniture.items.at(-1),
    );
  };
  const autoPlacement = () => {
    try {
      const next = placeLibraryFurniture(
        draft.document,
        placement.template,
        placement.preferredRoomId,
      );
      const candidate = next.furniture.items.at(-1);
      setPlacement((current) => ({
        ...current,
        point: { x: candidate.x, y: candidate.y },
        rotation: candidate.rotation,
      }));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  const useLibrary = (template) => {
    startPlacement(template);
    setLibraryOpen(false);
  };
  useEffect(() => {
    if (
      !placementRequest ||
      !draft.document ||
      consumedPlacement.current === placementRequest.id
    )
      return;
    consumedPlacement.current = placementRequest.id;
    try {
      useLibrary(placementRequest.template);
    } catch (e) {
      setError(e.message);
    }
    onPlacementConsumed?.();
  }, [placementRequest, draft.document]);
  const useDiy = (design, { preserveSize = true } = {}) => {
    const next = clone(draft.document);
    if (diyOpen.mode === "edit") {
      const target = next.furniture.items[diyOpen.index];
      if (!target || target.kind !== "custom")
        throw Error("选中家具已变化，请重新打开编辑。");
      Object.assign(target, updatePlacedDesign(target, design, preserveSize));
      reconcileFurnitureRoom(next, target);
    } else {
      startPlacement(placedDesign(design, { x: 0, y: 0 }, ""));
      setDiyOpen(null);
      return;
    }
    if (
      next.furniture.items.reduce(
        (sum, f) => sum + (f.diy?.parts.length || 0),
        0,
      ) > 512
    )
      throw Error("单个户型最多容纳 512 个 DIY 部件，请简化素材或减少数量。");
    draft.commit(next);
    setError("");
  };
  const addFurniture = () => {
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
      shower: [0.9, 0.9, 2.1],
      shower_walk_in: [1, 1, 2.1],
      shower_open: [0.9, 0.9, 2.1],
      refrigerator: [0.65, 0.65, 1.8],
      television: [1.24, 0.42, 1.36],
      wall_television: [1.24, 0.1, 0.71],
      tv_console: [1.8, 0.4, 0.52],
      coffee_table: [1.1, 0.62, 0.42],
      side_table: [0.45, 0.45, 0.55],
      nightstand: [0.48, 0.4, 0.52],
      bookshelf: [0.9, 0.32, 1.85],
      shoe_cabinet: [1, 0.35, 1.05],
      washing_machine: [0.6, 0.62, 0.85],
      dishwasher: [0.6, 0.6, 0.85],
      oven: [0.6, 0.6, 0.85],
      armchair: [0.78, 0.8, 0.86],
      bench: [0.9, 0.36, 0.46],
    }[furnitureKind];
    try {
      startPlacement({
        kind: furnitureKind,
        name: furnitureNames[furnitureKind],
        width: sizes[0],
        depth: sizes[1],
        height: sizes[2],
        elevation: furnitureKind === "wall_television" ? 1.05 : 0,
        rotation: 0,
      });
    } catch (e) {
      setError(e.message);
    }
  };
  const addOpening = (kind, targetId = targetWallId) => {
    const next = clone(draft.document),
      wall = next.layout.walls.find((wall) => wall.id === targetId);
    if (!wall) {
      setError("请先选择要安装门窗或通道的墙体。");
      return;
    }
    if (next.layout.openings.length >= 80) {
      setError("最多可放置 80 个门窗或通道。");
      return;
    }
    setWallId(targetId);
    setSelected(null);
    setTool(kind === "passage" ? "passages" : "openings");
    setDrawing(null);
    setPendingDelete(null);
    setPickingWall(false);
    setOpeningAnchor(null);
    setOpeningPreview(null);
    setOpeningKind(kind);
    setOpeningSequence((value) => value + 1);
    setAcknowledged(false);
    setError("");
  };
  const commitOpening = (opening) => {
    if (busy) return;
    const next = clone(draft.document);
    const errors = validateOpening(next.layout, opening);
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    next.layout.openings.push(opening);
    draft.commit(next);
    setAcknowledged(false);
    select("openings", next.layout.openings.length - 1, opening);
  };
  const remove = () => {
    if (!item || busy || locked.includes(`${selected.type}:${selected.index}`))
      return;
    setPendingDelete({ ...selected });
    setDeleteFurniture(false);
  };
  const confirmRemove = () => {
    try {
      draft.commit(
        removeObject(draft.document, pendingDelete, deleteFurniture),
      );
      setSelected(null);
      setMulti([]);

      setPendingDelete(null);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  const startDrawing = (type) => {
    cancelOpening();
    setDrawing({ type, points: [] });
    setPendingDelete(null);
    setSelected(null);
    navigation.reset();
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
        select("walls", next.layout.walls.length - 1, next.layout.walls.at(-1));
      } else {
        if (
          points.length < 3 ||
          !simplePolygon(points) ||
          polygonArea(points) < 0.2
        )
          throw Error("请绘制至少三个不交叉的角点，空间至少 0.2 ㎡。");
        if (next.layout.rooms.length >= 35) throw Error("最多支持 35 个空间。");
        if (
          next.layout.rooms.some(
            (r) =>
              simplePolygon(r.polygon) && overlapArea(points, r.polygon) > 1e-6,
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
    if (drawing.points.length >= (drawing.type === "walls" ? 2 : 24)) return;
    const points = [...drawing.points, point];
    setDrawing({ ...drawing, points });
    if (drawing.type === "walls" && points.length === 2) finishDrawing(points);
  };
  const save = async () => {
    if (
      !document ||
      issues.length ||
      busy ||
      saveLock.current ||
      drawing ||
      pendingDelete ||
      openingKind ||
      (reviewing && !acknowledged)
    )
      return;
    const invalidInput = root.current.querySelector(
      'input:invalid, input[aria-invalid="true"]',
    );
    if (invalidInput) {
      invalidInput.focus();
      setError("请先修正标红的输入值，再保存三维版本。");
      return;
    }
    saveLock.current = true;
    setBusy(true);
    setError("");
    try {
      if (reviewing) {
        await projects.confirmStructure(job.id, {
          layout: draft.document.layout,
          reviewed: true,
          revision: job.result.revision,
        });
        onClose();
      } else
        await projects.edit(job.id, {
          name: name.trim() || "人工设计方案",
          ...draft.document,
        });
    } catch (e) {
      setError(e.message);
    } finally {
      saveLock.current = false;
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
          {reviewing ? "返回结构核对" : "返回三维预览"}
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
    (selected?.type === type && selected.index === index) ||
    (type === "furniture" && multi.includes(index));
  const selectedName = item
    ? labelFor(item, selected.type, selected.index)
    : "选择一个对象";
  const changeWallPoint = (endpoint, axis, value) =>
    commitParameter(
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
      value={item[key] ?? (key === "elevation" ? 0 : undefined)}
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
  if (libraryOpen)
    return (
      <AssetLibrary
        materialRooms={document.layout.rooms.filter(
          (r) => r.floor_enabled !== false,
        )}
        materialRoomId={
          selected?.type === "rooms"
            ? document.layout.rooms[selected.index]?.id
            : "all"
        }
        floorOnly
        initialAssetType={libraryOpen === "materials" ? "materials" : "models"}
        onApplyMaterial={({ materialId, roomId }) => {
          draft.commit((next) => {
            for (const room of next.layout.rooms) {
              if (
                (roomId === "all" || room.id === roomId) &&
                room.floor_enabled !== false
              )
                room.floor_material = materialId;
            }
            return next;
          }, false);
          setTool("rooms");
          setSelected({
            type: "rooms",
            index: Math.max(
              0,
              document.layout.rooms.findIndex((r) => r.id === roomId),
            ),
          });
          setLibraryOpen(false);
        }}
        active={isActive}
        targetName={job.name}
        onClose={() => setLibraryOpen(false)}
        onPlace={useLibrary}
        onCreate={() => {
          setLibraryOpen(false);
          setDiyOpen({ mode: "add" });
        }}
      />
    );
  if (diyOpen)
    return (
      <Suspense fallback={<p role="status">正在打开家具设计器…</p>}>
        <DiyStudio
          onClose={() => setDiyOpen(null)}
          onUse={useDiy}
          active={isActive}
          placementSize={
            diyOpen.mode === "edit"
              ? [
                  document.furniture.items[diyOpen.index].width,
                  document.furniture.items[diyOpen.index].depth,
                  document.furniture.items[diyOpen.index].height,
                ]
              : null
          }
          initialDesign={
            diyOpen.mode === "edit"
              ? document.furniture.items[diyOpen.index]?.diy
              : null
          }
          useLabel={
            diyOpen.mode === "edit" ? "应用到选中家具" : "去户型选择位置"
          }
        />
      </Suspense>
    );
  const sceneCanvas = (
    <LivePreview
      document={document}
      committedDocument={draft.document}
      editError={error}
      placement={placement ? { active: true, ...placementResult } : null}
      onPlacementMove={movePlacement}
      onPlacementConfirm={confirmPlacement}
      active={isActive}
      busy={busy || !!drawing || pickingWall}
      selected={selected}
      onRotate={rotate}
      onRotationPreview={previewRotation}
      onRotationFinish={finishRotation}
      onRotationCancel={cancelRotation}
      jobId={job.id}
      onSelect={({ type, index }) => {
        if (drawing || placement) return;
        if (pickingWall) {
          if (type === "walls")
            chooseOpeningWall(document.layout.walls[index].id);
          return;
        }
        select(type, index);
      }}
      onGesture={(phase, transform, hitSelection) => {
        if (phase === "start") {
          const target = hitSelection || selected;
          if (busy || placement || drawing || pickingWall || !target)
            return false;
          sceneDrag.current = {
            document: draft.document,
            selection: { ...target },
          };
          select(target.type, target.index);
          return true;
        }
        const gesture = sceneDrag.current;
        if (phase === "cancel") {
          sceneDrag.current = null;
          setPreview(null);
          return;
        }
        if (!gesture) return;
        try {
          if (gesture.document !== draft.document)
            throw Error("设计数据已更新，本次拖动已取消，请重新操作。");
          const next = applySceneEdit(
            gesture.document,
            gesture.selection,
            transform,
          );
          const violation = lockedChange(gesture.document, next);
          if (violation) throw Error(violation);
          if (phase === "preview") {
            setError("");
            setPreview(next);
            return;
          }
          const errors = problems(next);
          if (errors.length) throw Error(errors[0].text);
          draft.commit(next);
          setError("");
        } catch (e) {
          setError(e.message);
        }
        if (phase === "end") {
          sceneDrag.current = null;
          setPreview(null);
        }
      }}
    />
  );
  return (
    <UnitContext.Provider value={displayUnit}>
      <div
        className={`manual-editor editor-view-${editorView}${focusCanvas ? " canvas-focused" : ""}`}
        ref={root}
      >
        <nav className="editor-page-nav" aria-label="人工设计页面">
          <div>
            {[
              ["plan", "平面设计"],
              ["scene", "三维设计"],
            ].map(([view, label]) => (
              <button
                key={view}
                aria-current={editorView === view ? "page" : undefined}
                disabled={busy}
                onClick={() => setEditorView(view)}
              >
                {label}
              </button>
            ))}
          </div>
          <span>
            {isScene ? "三维模型编辑 · 实时更新" : "平面图编辑 · 精确绘制"}
          </span>
        </nav>
        {placement && (
          <section
            className="furniture-placement-bar"
            aria-label="家具放置"
            data-valid={placementResult?.valid ?? true}
          >
            <div>
              <strong>
                正在放置 ·{" "}
                {placement.template.name ||
                  furnitureNames[placement.template.kind]}
              </strong>
              <span>
                {placementResult?.item.room_id
                  ? `${document.layout.rooms.find((r) => r.id === placementResult.item.room_id)?.name || ""} · `
                  : ""}
                {round(placement.template.width)} ×{" "}
                {round(placement.template.depth)} 米 ·{" "}
                {round(placementResult?.item.rotation ?? placement.rotation)}°
              </span>
              <p role="status">
                {placementResult?.message ||
                  (placement.template.kind === "wall_television"
                    ? "移动到墙边预览安装位置，点击放下；Esc 取消。"
                    : "移动鼠标预览占地，点击画布放下；R 旋转，Esc 取消。")}
              </p>
              {placement.template.kind === "wall_television" && (
                <small>靠近墙面自动吸附，方向随墙面调整。</small>
              )}
            </div>
            <div className="furniture-placement-actions">
              <button
                type="button"
                disabled={busy || placement.template.kind === "wall_television"}
                onClick={() =>
                  setPlacement((p) => ({
                    ...p,
                    rotation: (p.rotation + 90) % 360,
                  }))
                }
              >
                旋转 90°
              </button>
              <button type="button" disabled={busy} onClick={autoPlacement}>
                自动找空位
              </button>
              <button
                type="button"
                disabled={busy || !placementResult?.valid}
                onClick={() => confirmPlacement()}
              >
                确认放置
              </button>
              <button type="button" onClick={() => setPlacement(null)}>
                取消
              </button>
            </div>
          </section>
        )}
        <div className="edit-toolbar">
          <div className="edit-tool-tabs" hidden={!!designMode}>
            {tools
              .filter(([id]) =>
                designMode
                  ? ["walls", "rooms"].includes(id)
                  : !reviewing || !["furniture", "lights"].includes(id),
              )
              .map(([id, Icon, label]) => (
                <button
                  key={id}
                  className={tool === id ? "active" : ""}
                  aria-pressed={tool === id}
                  disabled={busy}
                  onClick={() => {
                    setTool(id);
                    if (designMode)
                      onDesignModeChange?.(id === "walls" ? "walls" : "floor");
                    setDrawing(null);
                    setPendingDelete(null);
                    cancelOpening();
                    setError("");
                    const first = objectEntries(document, id)[0];
                    const currentWall =
                      selected?.type === "walls"
                        ? document.layout.walls[selected.index]
                        : null;
                    if (["openings", "passages"].includes(id) && currentWall) {
                      setWallId(currentWall.id);
                      setSelected(null);
                    } else {
                      setSelected(
                        first ? { type: first.type, index: first.index } : null,
                      );
                      if (["openings", "passages"].includes(id) && first)
                        setWallId(first.object.wall_id);
                    }
                  }}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
          </div>
          <div className="edit-history">
            <button
              type="button"
              className="secondary-button"
              aria-pressed={focusCanvas}
              onClick={() => setFocusCanvas(!focusCanvas)}
            >
              <Focus size={14} />
              {focusCanvas ? "展开面板" : "专注画布"}
            </button>
            <button
              title="撤销设计"
              aria-label="撤销设计"
              onClick={() => {
                setDrawing(null);
                setPendingDelete(null);
                cancelOpening();
                setMulti([]);
                setSelected(null);
                setPlacement(null);
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
                cancelOpening();
                setMulti([]);
                setSelected(null);
                setPlacement(null);
                draft.redo();
              }}
              disabled={busy || !draft.canRedo}
            >
              <Redo2 size={16} />
            </button>
            <details className="editor-more">
              <summary>更多</summary>
              <div>
                <button
                  className="text-button"
                  onClick={() => {
                    setDrawing(null);
                    setPendingDelete(null);
                    cancelOpening();
                    setSelected(null);
                    setMulti([]);
                    setPlacement(null);
                    draft.reset();
                    setError("");
                  }}
                  disabled={busy}
                >
                  <RotateCcw size={13} />
                  还原原方案
                </button>
              </div>
            </details>
            <button className="secondary-button" onClick={onClose}>
              {reviewing ? "返回结构核对" : "返回方案预览"}
            </button>
          </div>
        </div>
        {!placement && !isScene && (
          <details className="editor-tools-disclosure">
            <summary>操作说明与步长</summary>
            <div className="edit-intro">
              <MousePointer2 size={15} />
              <p>
                {isScene
                  ? "直接拖动物体摆放；需要精调时修改右侧参数，停输后自动更新。"
                  : hints[tool]}
              </p>
              <label>
                {isScene ? "微移步长" : "吸附 / 微移"}
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
          </details>
        )}
        {drawing && !isScene && (
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
        {!isScene && !placement && (
          <details className="editor-tools-disclosure">
            <summary>辅助工具 · 测量、原图与批量操作</summary>
            {!isScene && !placement && (
              <PlanReferenceTools
                displayUnit={displayUnit}
                setDisplayUnit={setDisplayUnit}
                measureMode={measureMode}
                setMeasureMode={setMeasureMode}
                setBoxMode={setBoxMode}
                measure={measure}
                setMeasure={setMeasure}
                overlay={overlay}
                setOverlay={setOverlay}
                opacity={opacity}
                setOpacity={setOpacity}
                snap={snap}
                setSnap={setSnap}
                registration={registration}
                setRegistration={setRegistration}
                constraintError={draft.constraintError}
              />
            )}
            {!isScene && !placement && tool === "furniture" && (
              <div className="batch-toolbar">
                <button
                  aria-pressed={boxMode}
                  onClick={() => {
                    setBoxMode(!boxMode);
                    setMeasureMode(false);
                  }}
                >
                  框选家具
                </button>
                <button
                  onClick={() =>
                    setMulti(document.furniture.items.map((_, i) => i))
                  }
                >
                  全选家具
                </button>
                <button onClick={() => setMulti([])}>清除多选</button>
                <button
                  onClick={() =>
                    draft.commit((next) => {
                      next.furniture.items.forEach(
                        (f) => (f.edit_hidden = false),
                      );
                      return next;
                    }, false)
                  }
                >
                  显示隐藏对象
                </button>
                <button
                  aria-pressed={hideFurniture}
                  onClick={() => setHideFurniture(!hideFurniture)}
                >
                  {hideFurniture ? "显示家具" : "隐藏家具"}
                </button>
                {multi.length > 1 && (
                  <>
                    <span>选中 {multi.length} 件</span>
                    {[
                      ["group", "编为一组"],
                      ["ungroup", "解除组合"],
                      ["hide", "隐藏选中"],
                      ["align-x", "左右居中"],
                      ["align-y", "前后对齐"],
                      ["distribute", "横向等距"],
                      ["copy", "批量复制"],
                      ["delete", "批量删除"],
                    ].map(([op, title]) => (
                      <button
                        key={op}
                        onClick={() => {
                          try {
                            draft.commit(
                              batchFurniture(
                                draft.document,
                                multi.filter(
                                  (i) => !locked.includes(`furniture:${i}`),
                                ),
                                op,
                              ),
                            );
                            if (op === "delete") {
                              setMulti([]);
                              setSelected(null);
                            }
                          } catch (e) {
                            setError(e.message);
                          }
                        }}
                      >
                        {title}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </details>
        )}
        <div className="edit-columns">
          <aside
            className="edit-library edit-properties"
            aria-label="对象库与添加"
          >
            <div
              className="editor-sidebar-tabs"
              role="group"
              aria-label="对象面板"
            >
              <button
                aria-pressed={sidebarTab === "objects"}
                onClick={() => setSidebarTab("objects")}
              >
                已放置 <small>{entries.length}</small>
              </button>
              <button
                aria-pressed={sidebarTab === "add"}
                onClick={() => setSidebarTab("add")}
              >
                <Plus size={14} />
                添加
              </button>
            </div>
            <fieldset disabled={busy || (!!drawing && !isScene)}>
              <div
                className="edit-section object-browser"
                hidden={sidebarTab !== "objects"}
              >
                <div className="section-heading">
                  <h2>当前对象</h2>
                  <MousePointer2 size={14} />
                </div>
                <label className="edit-label">
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
                  {!isScene && tool === "furniture" && " · Shift 点击多选"}
                </p>
                <div className="edit-object-list" aria-label="设计对象列表">
                  {filteredEntries.map(({ object, index, type }) => (
                    <button
                      key={index}
                      aria-pressed={active(type, index)}
                      onClick={(e) => {
                        if (type === "furniture")
                          setMulti((v) =>
                            e.shiftKey
                              ? v.includes(index)
                                ? v.filter((i) => i !== index)
                                : [...v, index]
                              : [index],
                          );
                        select(type, index);
                      }}
                    >
                      <span>{labelFor(object, type, index)}</span>
                      <small>
                        {type === "furniture"
                          ? document.layout.rooms.find(
                              (r) => r.id === object.room_id,
                            )?.name
                          : type === "walls"
                            ? resolveMaterial(object.wall_material)?.name ||
                              "基础饰面"
                            : type === "rooms"
                              ? resolveMaterial(object.floor_material)?.name ||
                                "基础地板"
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
                {item && !isScene && (
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
                      navigation.focus({ x: point.x, y: point.y }, 1.6);
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
              <div
                className="edit-section object-adder"
                hidden={sidebarTab !== "add"}
              >
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
                            elevation:
                              {
                                floor_lamp: 1.5,
                                table_lamp: 0.85,
                                ceiling: 2.65,
                                downlight: 2.65,
                              }[lightKind] || 2.4,
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
                      {isScene
                        ? "在三维画布切换「夜晚」查看灯光效果。最多 12"
                        : "保存并生成三维后，在设计预览切换「夜晚」。最多 12"}
                      盏灯，可单独开关。
                    </p>
                  </>
                )}
                {tool === "furniture" && (
                  <button
                    className="diy-library-trigger"
                    onClick={() => {
                      setPlacement(null);
                      setLibraryOpen(true);
                    }}
                  >
                    <Armchair size={14} />从 GLB 素材库添加
                  </button>
                )}
                {tool === "furniture" && (
                  <button
                    className="diy-library-trigger"
                    onClick={() => {
                      setPlacement(null);
                      setDiyOpen({ mode: "add" });
                    }}
                  >
                    <Sparkles size={14} />
                    DIY 素材库
                  </button>
                )}
                {tool === "furniture" && (
                  <div className="add-furniture">
                    <select
                      aria-label="新增家具类型"
                      value={furnitureKind}
                      onChange={(e) => setFurnitureKind(e.target.value)}
                    >
                      {Object.entries(furnitureNames)
                        .filter(([id]) => !["custom", "model"].includes(id))
                        .map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                    </select>
                    <button className="secondary-button" onClick={addFurniture}>
                      <Plus size={13} />
                      选择位置
                    </button>
                  </div>
                )}
                {tool === "walls" && (
                  <button
                    className="secondary-button full-width"
                    onClick={() => startDrawing("walls")}
                  >
                    <Plus size={14} />
                    {isScene ? "添加墙体" : "绘制新墙体"}
                  </button>
                )}
                {tool === "rooms" && (
                  <>
                    <button
                      className="secondary-button full-width"
                      onClick={() => startDrawing("rooms")}
                    >
                      <Plus size={14} />
                      {isScene ? "添加空间 / 地板" : "绘制新空间 / 地板"}
                    </button>
                    <p className="field-note">
                      {isScene
                        ? "输入空间边界坐标后添加，新增空间不能与已有空间重叠。"
                        : "在空白区域依次点击角点，轮廓自动适配新增空间。已有空间占满时，可先拆分空间或删除原空间再重画。"}
                    </p>
                  </>
                )}
                {isScene && drawing && (
                  <SceneStructureForm
                    key={drawing.type}
                    type={drawing.type}
                    origin={center(document.layout.outline)}
                    onCreate={finishDrawing}
                    onCancel={() => setDrawing(null)}
                  />
                )}
                {["openings", "passages"].includes(tool) && (
                  <>
                    <label className="edit-label">
                      添加到墙体
                      <select
                        aria-label="添加开口的墙体"
                        value={targetWallId}
                        disabled={!document.layout.walls.length}
                        onChange={(e) => chooseOpeningWall(e.target.value)}
                      >
                        {document.layout.walls.map((wall, index) => (
                          <option key={wall.id} value={wall.id}>
                            {labelFor(wall, "walls", index)} ·{" "}
                            {wallLength(wall).toFixed(2)} m
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="secondary-button pick-opening-wall"
                      aria-label={
                        isScene ? "在三维中选择安装墙体" : "在图上选择安装墙体"
                      }
                      aria-pressed={pickingWall}
                      disabled={!document.layout.walls.length}
                      onClick={() => {
                        setPickingWall((value) => !value);
                        navigation.setPanMode(false);
                      }}
                    >
                      <MousePointer2 size={13} />
                      {pickingWall
                        ? "取消选墙"
                        : isScene
                          ? "在三维中选墙"
                          : "在图上选墙"}
                    </button>
                    <p className="field-note">
                      {isScene
                        ? "可从列表选择安装墙体，或开启选墙后点击三维墙面。"
                        : pickingWall
                          ? "点击目标墙线，绿色高亮表示安装墙体。"
                          : "可从列表选择，也可直接点击图上的墙线。"}
                    </p>
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
          {isScene ? (
            sceneCanvas
          ) : (
            <section className="plan-editor-canvas">
              <div className="plan-sheet-head">
                <span>
                  <i />
                  俯视设计 · 图纸坐标：米
                </span>
                <small>平面设计 · 修改自动保留为草稿</small>
              </div>
              <svg
                ref={svg}
                viewBox={viewBox}
                role="application"
                aria-label="人工设计平面图"
                aria-describedby={`plan-navigation-${job.id}`}
                tabIndex={0}
                className={
                  navigation.panning
                    ? "is-panning"
                    : navigation.panMode || navigation.spaceHeld
                      ? "can-pan"
                      : ""
                }
                onPointerEnter={navigation.onPointerEnter}
                onPointerLeave={navigation.onPointerLeave}
                onPointerDownCapture={(event) => {
                  if (
                    placement &&
                    event.button === 0 &&
                    !navigation.spaceHeld &&
                    !navigation.panMode
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    placementPointer.current = {
                      id: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                    };
                    svg.current.setPointerCapture(event.pointerId);
                    movePlacement(pointAt(event));
                    return;
                  }
                  if (event.button === 0 && measureMode) {
                    event.stopPropagation();
                    event.preventDefault();
                    const p = pointAt(event);
                    setMeasure((v) => (v.length === 1 ? [...v, p] : [p]));
                    return;
                  }
                  if (event.button === 0 && boxMode && tool === "furniture") {
                    event.stopPropagation();
                    event.preventDefault();
                    const p = pointAt(event);
                    marquee.current = { start: p };
                    setSelectionBox({ start: p, end: p });
                    svg.current.setPointerCapture(event.pointerId);
                    return;
                  }
                  navigation.onPointerDownCapture(event);
                }}
                onPointerDown={(event) => {
                  lastNavigationClick.current = !drawing;
                  if (drawing) drawPoint(event);
                  else if (event.button === 0) navigation.beginPan(event);
                }}
                onDoubleClick={(event) => {
                  if (!drawing && lastNavigationClick.current)
                    navigation.reset();
                }}
                onPointerMove={pointerMove}
                onPointerUpCapture={(event) => {
                  const down = placementPointer.current;
                  if (!down || down.id !== event.pointerId) return;
                  placementPointer.current = null;
                  event.preventDefault();
                  event.stopPropagation();
                  if (svg.current.hasPointerCapture(event.pointerId))
                    svg.current.releasePointerCapture(event.pointerId);
                  const rect = svg.current.getBoundingClientRect();
                  if (
                    placement &&
                    Math.hypot(
                      event.clientX - down.x,
                      event.clientY - down.y,
                    ) <= 5 &&
                    event.clientX >= rect.left &&
                    event.clientX <= rect.right &&
                    event.clientY >= rect.top &&
                    event.clientY <= rect.bottom
                  )
                    confirmPlacement(pointAt(event));
                }}
                onPointerCancelCapture={() => {
                  placementPointer.current = null;
                }}
                onPointerUp={(e) => end(e)}
                onPointerCancel={(e) => end(e, true)}
                onLostPointerCapture={(e) => {
                  placementPointer.current = null;
                  if (navigation.finishPan(e, true)) return;
                  if (drag.current) end(e, true);
                }}
                onKeyDown={(e) => {
                  if (placement) return;
                  if (e.key === "Escape") {
                    navigation.finishPan(null, true);
                    drag.current = null;
                    setPreview(null);
                    setDrawing(null);
                    setPendingDelete(null);
                    cancelOpening();
                    return;
                  }
                  if (
                    drag.current ||
                    navigation.panMode ||
                    navigation.spaceHeld
                  )
                    return;
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
                    move(
                      ...offsets[e.key].map((v) => v * (e.shiftKey ? 10 : 1)),
                    );
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
                  data-plan-background="true"
                  x={box.x - 60}
                  y={box.y - 60}
                  width={box.width + 120}
                  height={box.height + 120}
                  fill="#eaf0e8"
                />
                <rect
                  data-plan-background="true"
                  x={box.x - 60}
                  y={box.y - 60}
                  width={box.width + 120}
                  height={box.height + 120}
                  fill={`url(#grid-${job.id})`}
                />
                <polygon
                  data-plan-outline="true"
                  points={document.layout.outline
                    .map((p) => `${p.x},${p.y}`)
                    .join(" ")}
                  pointerEvents="none"
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
                          if (placement) return;
                          if (e.key === "Enter") select("rooms", index);
                        }}
                        points={room.polygon
                          .map((p) => `${p.x},${p.y}`)
                          .join(" ")}
                        fill={floorColor(
                          room,
                          floorColors[room.floor_finish || "default"],
                        )}
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
                    aria-label={`${openingTool ? "选择安装墙体" : "选择墙体"} ${index + 1}`}
                    tabIndex={tool === "walls" || openingTool ? 0 : -1}
                    onKeyDown={(e) => {
                      if (placement) return;
                      if (e.key === "Enter" && !busy && !drawing) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (openingTool) chooseOpeningWall(wall.id);
                        else select("walls", index);
                      }
                    }}
                    onPointerDown={
                      tool === "walls"
                        ? (e) => begin(e, { type: "walls", index })
                        : openingTool && !drawing
                          ? (e) => {
                              if (busy || e.button !== 0) return;
                              e.preventDefault();
                              e.stopPropagation();
                              lastNavigationClick.current = false;
                              svg.current.focus({ preventScroll: true });
                              chooseOpeningWall(wall.id, pointAt(e));
                            }
                          : undefined
                    }
                    style={{
                      pointerEvents:
                        tool === "walls" || openingTool ? "auto" : "none",
                      cursor: openingTool ? "pointer" : "move",
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
                        active("walls", index) ||
                        (openingTool && targetWallId === wall.id)
                          ? "#318765"
                          : resolveMaterial(wall.wall_material)?.color ||
                            (wall.exterior ? "#445a55" : "#748880")
                      }
                      strokeWidth={
                        wall.thickness +
                        (openingTool && targetWallId === wall.id ? 0.04 : 0)
                      }
                      strokeLinecap="square"
                    />
                  </g>
                ))}
                {openingKind &&
                  openingPreview &&
                  (() => {
                    const { opening, valid } = openingPreview;
                    const wall = document.layout.walls.find(
                      (wall) => wall.id === opening.wall_id,
                    );
                    if (
                      !wall ||
                      ![opening.offset, opening.width].every(Number.isFinite)
                    )
                      return null;
                    const [a, b] = openingPoints(opening, wall);
                    return (
                      <g pointerEvents="none" data-opening-preview="true">
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke={valid ? "#247c93" : "#bb653a"}
                          strokeWidth={wall.thickness + 0.08}
                          strokeDasharray="0.12 0.08"
                        />
                        {opening.kind === "door" &&
                          opening.door_leaf !== false &&
                          Number.isFinite(opening.angle) &&
                          (() => {
                            const [hinge, tip] = doorLeafPoints(opening, wall);
                            return (
                              <line
                                x1={hinge.x}
                                y1={hinge.y}
                                x2={tip.x}
                                y2={tip.y}
                                stroke={valid ? "#247c93" : "#bb653a"}
                                strokeWidth="0.045"
                                strokeDasharray="0.1 0.06"
                              />
                            );
                          })()}
                        <circle
                          cx={wall.start.x}
                          cy={wall.start.y}
                          r="0.07"
                          fill="#fff"
                          stroke="#247c93"
                          strokeWidth="0.025"
                        />
                        <text
                          x={wall.start.x}
                          y={wall.start.y - 0.2}
                          fontSize="0.16"
                          fill="#264e48"
                        >
                          墙起点
                        </text>
                        <text
                          x={(a.x + b.x) / 2}
                          y={(a.y + b.y) / 2 + 0.32}
                          textAnchor="middle"
                          fontSize="0.18"
                          fill={valid ? "#247c93" : "#a34e27"}
                        >
                          待添加{openingNames[opening.kind]} · {opening.width} m
                        </text>
                      </g>
                    );
                  })()}
                {document.layout.openings.map((opening, index) => {
                  const wall = document.layout.walls.find(
                    (w) => w.id === opening.wall_id,
                  );
                  if (!wall) return null;
                  const [a, b] = openingPoints(opening, wall);
                  const selectable =
                    toolFor("openings", opening) === tool &&
                    !drawing &&
                    !openingKind &&
                    !pickingWall;
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
                        if (placement) return;
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
                        stroke={
                          active("openings", index) ? "#61b78a" : "#eaf0e8"
                        }
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
                {!hideFurniture &&
                  document.furniture.items.map(
                    (f, index) =>
                      !f.edit_hidden && (
                        <g
                          key={index}
                          role="button"
                          aria-label={`选择家具 ${f.name || furnitureNames[f.kind]} ${index + 1}`}
                          tabIndex={tool === "furniture" ? 0 : -1}
                          onKeyDown={(e) => {
                            if (placement) return;
                            if (e.key === "Enter") select("furniture", index);
                          }}
                          transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`}
                          onPointerDown={
                            tool === "furniture"
                              ? (e) => begin(e, { type: "furniture", index })
                              : undefined
                          }
                          style={{
                            pointerEvents:
                              tool === "furniture" ? "auto" : "none",
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
                            stroke={
                              active("furniture", index) ? "#297957" : "#907c5e"
                            }
                            strokeWidth={
                              active("furniture", index) ? 0.04 : 0.018
                            }
                            strokeDasharray={
                              f.kind === "rug" ? ".06 .04" : undefined
                            }
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
                            fontSize={Math.min(
                              0.16,
                              f.width / 3.5,
                              f.depth / 2.5,
                            )}
                          >
                            {f.name || furnitureNames[f.kind]}
                          </text>
                        </g>
                      ),
                  )}
                {(document.layout.lights || []).map((light, index) => (
                  <g
                    key={light.id}
                    role="button"
                    aria-label={`选择灯具 ${light.name}`}
                    tabIndex={tool === "lights" ? 0 : -1}
                    onKeyDown={(e) => {
                      if (placement) return;
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
                        light.enabled
                          ? lightColors[light.temperature]
                          : "#abb0a4"
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
                  selected.type === "rooms" &&
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
                        aria-label={`拖动地板角点 ${index + 1}`}
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
                        if (placement) return;
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
                      points={drawing.points
                        .map((p) => `${p.x},${p.y}`)
                        .join(" ")}
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
                {selected?.type === "walls" &&
                  item &&
                  wallSides(item, document.layout.rooms).map((side) => (
                    <text
                      key={side.side}
                      x={side.x}
                      y={side.y}
                      textAnchor="middle"
                      fontSize=".16"
                      fill="#175938"
                      stroke="white"
                      strokeWidth=".04"
                      paintOrder="stroke"
                      pointerEvents="none"
                    >
                      {side.label}
                    </text>
                  ))}
                {measure.length === 2 && (
                  <g pointerEvents="none">
                    <line
                      x1={measure[0].x}
                      y1={measure[0].y}
                      x2={measure[1].x}
                      y2={measure[1].y}
                      stroke="#b15819"
                      strokeWidth=".025"
                      strokeDasharray=".08 .04"
                    />
                    <text
                      x={(measure[0].x + measure[1].x) / 2}
                      y={(measure[0].y + measure[1].y) / 2 - 0.1}
                      fontSize=".18"
                      fill="#73340b"
                    >
                      {Math.hypot(
                        measure[1].x - measure[0].x,
                        measure[1].y - measure[0].y,
                      ).toFixed(2)}{" "}
                      m
                    </text>
                  </g>
                )}
                {selectionBox && (
                  <rect
                    x={Math.min(selectionBox.start.x, selectionBox.end.x)}
                    y={Math.min(selectionBox.start.y, selectionBox.end.y)}
                    width={Math.abs(selectionBox.start.x - selectionBox.end.x)}
                    height={Math.abs(selectionBox.start.y - selectionBox.end.y)}
                    fill="#63987533"
                    stroke="#28613b"
                    strokeWidth=".025"
                    pointerEvents="none"
                  />
                )}
                {overlay && (
                  <image
                    transform={`translate(${box.x + box.width / 2 + registration.x} ${box.y + box.height / 2 + registration.y}) rotate(${registration.rotation}) scale(${registration.scale}) translate(${-box.x - box.width / 2} ${-box.y - box.height / 2})`}
                    href={
                      job.source_url ||
                      `/api/jobs/${job.id}/artifacts/source.png`
                    }
                    x={box.x}
                    y={box.y}
                    width={box.width}
                    height={box.height}
                    opacity={opacity}
                    preserveAspectRatio="xMidYMid meet"
                    pointerEvents="none"
                  />
                )}
                {placementResult && (
                  <g pointerEvents="none">
                    <polygon
                      points={furnitureCorners(placementResult.item)
                        .map((p) => `${p.x},${p.y}`)
                        .join(" ")}
                      fill={placementResult.valid ? "#10b98133" : "#ef444433"}
                      stroke={placementResult.valid ? "#047857" : "#dc2626"}
                      strokeWidth=".045"
                      strokeDasharray=".12 .06"
                    />
                    <text
                      x={placementResult.item.x}
                      y={placementResult.item.y}
                      textAnchor="middle"
                      fontSize=".18"
                      fill={placementResult.valid ? "#065f46" : "#991b1b"}
                    >
                      待放置
                    </text>
                  </g>
                )}
              </svg>
              <div className="plan-navigation">
                <p
                  className="plan-navigation-hint"
                  id={`plan-navigation-${job.id}`}
                >
                  滚轮缩放 · 拖空白平移 · 空格拖动
                </p>
                <div className="plan-zoom">
                  <div
                    className="plan-navigation-modes"
                    role="group"
                    aria-label="画布操作模式"
                  >
                    <button
                      aria-label="选择并编辑"
                      title="选择／编辑：选择对象，拖动修改布局"
                      aria-pressed={!navigation.panMode}
                      onClick={() => navigation.setPanMode(false)}
                    >
                      <MousePointer2 size={15} />
                    </button>
                    <button
                      aria-label="平移画布"
                      title="平移：在任意位置拖动画布"
                      aria-pressed={navigation.panMode}
                      onClick={() => navigation.setPanMode(true)}
                    >
                      <Hand size={15} />
                    </button>
                  </div>
                  <button
                    aria-label="缩小平面图"
                    onClick={() => navigation.zoomBy(1 / 1.2)}
                  >
                    <Minus size={15} />
                  </button>
                  <span className="plan-zoom-value">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    aria-label="放大平面图"
                    onClick={() => navigation.zoomBy(1.2)}
                  >
                    <Plus size={15} />
                  </button>
                  <button
                    aria-label="适配平面图"
                    title="适配全图（双击空白处或按 0）"
                    onClick={navigation.reset}
                  >
                    <Focus size={15} />
                  </button>
                </div>
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
          )}
          <LiveParameterContext.Provider value={isScene && !busy && !drawing}>
            <aside
              key={`${editorView}:${selected?.type}:${item?.edit_id || item?.id || selected?.index}`}
              className="edit-properties edit-inspector"
              aria-label="对象属性"
            >
              <div className="inspector-heading">
                <span>对象属性</span>
                <strong>
                  {openingKind
                    ? `新增${openingNames[openingKind]}`
                    : selectedName}
                </strong>
                <small>
                  {isScene
                    ? item
                      ? "参数停输后自动更新 · Enter 立即应用"
                      : "从对象库或三维模型选择对象"
                    : item
                      ? "修改即时反映在平面图"
                      : "从对象库或平面图选择对象"}
                </small>
              </div>
              {item && (
                <button
                  className="text-button"
                  onClick={() => {
                    const key = `${selected.type}:${selected.index}`;
                    toggleLock();
                  }}
                >
                  {locked.includes(`${selected.type}:${selected.index}`)
                    ? "解锁对象"
                    : "锁定对象"}
                </button>
              )}
              <fieldset
                disabled={
                  busy ||
                  !!drawing ||
                  locked.includes(`${selected?.type}:${selected?.index}`)
                }
              >
                {item && ["rooms", "walls"].includes(selected?.type) && (
                  <LocalReview
                    key={`${selected.type}:${item.id}`}
                    job={job}
                    document={draft.document}
                    selected={selected}
                    onApply={(next) => draft.commit(next, false)}
                    onLocate={(type, id) => {
                      const index = objects(document, type).findIndex(
                        (x) => x.id === id,
                      );
                      if (index >= 0) {
                        select(type, index);
                        const object = objects(document, type)[index];
                        navigation.focus(
                          type === "rooms"
                            ? center(object.polygon)
                            : {
                                x: (object.start.x + object.end.x) / 2,
                                y: (object.start.y + object.end.y) / 2,
                              },
                          Math.max(1.5, navigation.zoom),
                        );
                      }
                    }}
                  />
                )}
                {openingKind && (
                  <OpeningComposer
                    key={`${openingKind}-${openingSequence}`}
                    layout={document.layout}
                    wallId={targetWallId}
                    kind={openingKind}
                    anchor={openingAnchor}
                    onPreview={setOpeningPreview}
                    onAdd={commitOpening}
                    onCancel={cancelOpening}
                  />
                )}
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
                        <LightGroupControls
                          document={document}
                          index={selected.index}
                          onCommit={draft.commit}
                        />
                      </>
                    )}
                    {selected.type === "furniture" && (
                      <>
                        {showerKinds.includes(item.kind) && (
                          <label className="edit-label">
                            淋浴形式
                            <select
                              aria-label="淋浴形式"
                              value={item.kind}
                              onChange={(e) =>
                                patch((_, target) => {
                                  target.kind = e.target.value;
                                  target.name = furnitureNames[e.target.value];
                                  target.asset_id = null;
                                })
                              }
                            >
                              <option value="shower">
                                独立淋浴房 · 带实体背板
                              </option>
                              <option value="shower_walk_in">
                                步入式 · 单片玻璃隔断
                              </option>
                              <option value="shower_open">
                                开放式 · 花洒与地漏
                              </option>
                            </select>
                            <span className="field-note">
                              步入式和开放式借用房间原有墙面，不新增房间。0°
                              时花洒朝上方墙面、入口朝下方；旋转可调整方向。请避开窗户并预留至少
                              0.55 米入口空间。
                              开放式需结合实际防水、排水和挡水设计。切换形式保留位置与尺寸，并同步三维预览。
                            </span>
                          </label>
                        )}
                        {item.kind === "custom" && (
                          <button
                            className="diy-library-trigger"
                            onClick={() =>
                              setDiyOpen({
                                mode: "edit",
                                index: selected.index,
                              })
                            }
                          >
                            <Sparkles size={14} />
                            编辑 DIY 部件
                          </button>
                        )}
                        <details
                          className="inspector-group"
                          open={isScene ? undefined : true}
                        >
                          <summary>旋转与朝向</summary>
                          <RotationControl
                            key={item.edit_id || selected.index}
                            onPreview={previewRotation}
                            onFinish={finishRotation}
                            onCancel={cancelRotation}
                            scene={isScene}
                            value={item.rotation}
                            onChange={rotate}
                          />
                        </details>
                        <details className="inspector-group" open>
                          <summary>尺寸</summary>
                          <div className="edit-number-grid">
                            {number("家具宽度", "width", 0.1, 6)}
                            {number("家具进深", "depth", 0.1, 6)}
                            {number("家具高度", "height", 0.02, 3)}
                          </div>
                        </details>
                        <details className="inspector-group">
                          <summary>位置与离地高度</summary>
                          <div className="edit-number-grid">
                            {number("左右位置", "x", -60, 60)}
                            {number("上下位置", "y", -60, 60)}
                            {number(
                              "底部离地高度",
                              "elevation",
                              0,
                              Math.min(3, 4.5 - item.height),
                            )}
                          </div>
                          <p className="field-note">
                            坐标为家具中心，尺寸为旋转前的本体尺寸。跨空间移动后自动匹配能完整容纳家具的空间。
                            {item.kind === "wall_television" &&
                              "壁挂电视建议底部离地 1.05 米，可放在低电视柜上方；安装高度保存后反映在三维模型中。"}
                          </p>
                        </details>
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
                              disabled={
                                item.kind === "custom" || !!item.asset_id
                              }
                              value={item.kind}
                              onChange={(e) =>
                                patch((_, target) => {
                                  target.kind = e.target.value;
                                })
                              }
                            >
                              {item.kind === "custom" && (
                                <option value="custom">DIY 自定义素材</option>
                              )}
                              {item.kind === "model" && (
                                <option value="model">GLB 素材</option>
                              )}
                              {Object.entries(furnitureNames)
                                .filter(
                                  ([id]) => !["custom", "model"].includes(id),
                                )
                                .map(([id, name]) => (
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
                        <label>
                          <input
                            type="checkbox"
                            checked={!!item.load_bearing}
                            onChange={(e) =>
                              patch((_, w) => {
                                w.load_bearing = e.target.checked;
                              })
                            }
                          />{" "}
                          已核实为承重墙
                        </label>
                        {item.load_bearing && (
                          <p className="workspace-note">
                            已标记承重结构，改动前需专业人员核实。
                          </p>
                        )}
                        <details className="edit-advanced">
                          <summary>按此墙长度校准平面尺寸</summary>
                          <p>
                            当前长 {wallLength(item).toFixed(3)}{" "}
                            m；校准会等比调整全屋平面，墙高与家具高度保持不变，可撤销。
                          </p>
                          <NumberField
                            label="墙体实际长度"
                            value={actualLength}
                            min={0.1}
                            max={60}
                            onCommit={setActualLength}
                          />
                          <button
                            onClick={() => {
                              try {
                                draft.commit(
                                  calibrate(
                                    draft.document,
                                    wallLength(item),
                                    actualLength,
                                  ),
                                  false,
                                );
                              } catch (e) {
                                setError(e.message);
                              }
                            }}
                          >
                            应用尺寸校准
                          </button>
                        </details>
                        <WallElevation
                          wall={item}
                          openings={document.layout.openings}
                          onChange={(regions) =>
                            patch((_, w) => {
                              w.finish_regions = regions;
                            })
                          }
                        />
                        <label className="edit-label">
                          装修哪一侧
                          <select
                            aria-label="墙面装修侧"
                            value={wallSide}
                            onChange={(e) => setWallSide(e.target.value)}
                          >
                            <option value="both">整段墙体 · 两侧统一</option>
                            <option value="left">
                              A 面 ·{" "}
                              {wallSides(item, document.layout.rooms)[0]?.room}
                            </option>
                            <option value="right">
                              B 面 ·{" "}
                              {wallSides(item, document.layout.rooms)[1]?.room}
                            </option>
                          </select>
                        </label>
                        <SurfaceFinishPicker
                          category="walls"
                          hint={
                            wallSide === "both"
                              ? "统一此墙两侧材质，并清除两侧单独设置。"
                              : `仅修改 ${wallSide === "left" ? "A" : "B"} 面，另一侧保持原样。`
                          }
                          value={
                            wallSide === "both"
                              ? item.wall_material
                              : item[`material_${wallSide}`] ||
                                item.wall_material
                          }
                          onChange={(id) =>
                            patch((_, target) => {
                              if (wallSide === "both") {
                                target.wall_material = id;
                                target.material_left = null;
                                target.material_right = null;
                              } else target[`material_${wallSide}`] = id;
                            })
                          }
                        />
                        <p className="field-note">
                          当前选择：墙体 {selected.index + 1} ·
                          修改后同步三维预览，保存可生成独立版本。
                        </p>
                        <SurfaceTransfer
                          document={document}
                          type="walls"
                          index={selected.index}
                          side={wallSide}
                          onCommit={draft.commit}
                        />
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
                          基础墙面饰面
                          <select
                            value={item.finish || "default"}
                            aria-label="基础墙面饰面"
                            onChange={(e) =>
                              patch((_, target) => {
                                target.finish = e.target.value;
                                target.wall_material = null;
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
                              onClick={() => addOpening(kind, item.id)}
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
                        <SurfaceFinishPicker
                          category="floor"
                          value={item.floor_material}
                          disabled={item.floor_enabled === false}
                          onChange={(id) =>
                            patch((_, target) => {
                              target.floor_material = id;
                            })
                          }
                        />
                        <SurfaceTransfer
                          document={document}
                          type="rooms"
                          index={selected.index}
                          onCommit={draft.commit}
                        />
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
                          基础地板材质
                          <select
                            aria-label="地板材质"
                            value={
                              item.floor_material
                                ? `material:${item.floor_material}`
                                : item.floor_finish || "default"
                            }
                            disabled={item.floor_enabled === false}
                            onChange={(e) =>
                              patch((_, target) => {
                                if (e.target.value.startsWith("material:"))
                                  target.floor_material =
                                    e.target.value.slice(9);
                                else {
                                  target.floor_finish = e.target.value;
                                  target.floor_material = null;
                                }
                              })
                            }
                          >
                            {Object.entries(floorFinishes).map(([id, name]) => (
                              <option key={id} value={id}>
                                {name}
                              </option>
                            ))}
                            <optgroup label="素材库 · 地板配色">
                              {item.floor_material &&
                                !materialCategories.floor.includes(
                                  item.floor_material,
                                ) &&
                                resolveMaterial(item.floor_material) && (
                                  <option
                                    value={`material:${item.floor_material}`}
                                  >
                                    已保存 ·{" "}
                                    {resolveMaterial(item.floor_material).name}
                                  </option>
                                )}
                              {materialCategories.floor.map((id) => (
                                <option key={id} value={`material:${id}`}>
                                  {materials.find((m) => m.id === id).name}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </label>
                        <button
                          className="secondary-button"
                          disabled={item.floor_enabled === false}
                          onClick={() => setLibraryOpen("materials")}
                        >
                          从素材库选择地板
                        </button>
                        <div className="edit-number-grid">
                          <NumberField
                            label="铺贴方向"
                            value={item.floor_rotation || 0}
                            min={-180}
                            max={180}
                            unit="°"
                            onCommit={(v) =>
                              patch((_, r) => {
                                r.floor_rotation = v;
                              })
                            }
                          />
                          <NumberField
                            label="纹理比例"
                            value={item.floor_scale || 1}
                            min={0.1}
                            max={10}
                            step={0.1}
                            unit="倍"
                            onCommit={(v) =>
                              patch((_, r) => {
                                r.floor_scale = v;
                              })
                            }
                          />
                        </div>
                        <p className="field-note">
                          当前地板面积 {polygonArea(item.polygon).toFixed(2)}{" "}
                          ㎡。拖动圆点调整范围；地板单独调整不会移动墙体。
                        </p>
                        <FloorTiling
                          room={item}
                          onChange={(key, value) =>
                            patch((_, r) => {
                              r[key] = value;
                            })
                          }
                        />
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
                            {Object.entries(openingChoices).map(
                              ([id, name]) => (
                                <option key={id} value={id}>
                                  {name}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <label className="edit-label">
                          所在墙体
                          <select
                            value={item.wall_id}
                            onChange={(e) => {
                              patch((next, target) => {
                                target.wall_id = e.target.value;
                                target.offset = 0;
                              });
                              setWallId(e.target.value);
                            }}
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
                            wall
                              ? Math.max(0, wallLength(wall) - item.width)
                              : 60,
                          )}
                          {number(
                            "开口宽度",
                            "width",
                            0.1,
                            wall
                              ? Math.max(0.1, wallLength(wall) - item.offset)
                              : 60,
                          )}
                          {number(
                            "开口高度",
                            "height",
                            0.1,
                            wall
                              ? Math.max(0.1, wall.height - (item.bottom || 0))
                              : 4.5,
                          )}
                          {item.kind === "window" &&
                            number(
                              "窗台离地",
                              "bottom",
                              0,
                              wall ? Math.max(0, wall.height - item.height) : 3,
                            )}
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
                        <details className="inspector-group">
                          <summary>精确微移</summary>
                          <label className="edit-label">
                            移动步长
                            <select
                              aria-label="精确微移步长"
                              value={step}
                              onChange={(e) => setStep(Number(e.target.value))}
                            >
                              <option value={0.1}>10 厘米</option>
                              <option value={0.05}>5 厘米</option>
                              <option value={0.01}>1 厘米</option>
                            </select>
                          </label>
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
                        </details>
                        <div className="edit-delete-row">
                          {selected.type === "furniture" && (
                            <button
                              onClick={() => {
                                if (document.furniture.items.length >= 90)
                                  return;
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
          </LiveParameterContext.Provider>
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
        <div className="edit-feedback">
          <div
            className={`edit-check-summary ${hasFeedback ? "has-problems" : "is-clear"}`}
            role="status"
          >
            {hasFeedback ? <AlertTriangle size={15} /> : <Check size={15} />}
            <p title={error || draft.storageError || ""}>
              {error ||
                draft.storageError ||
                (issues.length
                  ? `${issues.length} 处布局问题，请调整后保存`
                  : serverCheck.status === "checking"
                    ? "基础检查通过 · 正在检查碰撞与通行"
                    : serverCheck.status === "done"
                      ? serverCheck.issues.length
                        ? `${serverCheck.issues.length} 项设计建议`
                        : "几何与通行检查通过"
                      : "基础检查通过")}
            </p>
            <button
              type="button"
              aria-label="查看布局问题"
              aria-expanded={validationOpen && hasFeedback}
              aria-controls={`edit-feedback-${job.id}`}
              disabled={!hasFeedback}
              onClick={() => setValidationOpen((value) => !value)}
            >
              {validationOpen && hasFeedback ? "收起" : "查看"}
            </button>
          </div>
          {hasFeedback && validationOpen && (
            <div
              className="edit-issues"
              role="alert"
              id={`edit-feedback-${job.id}`}
            >
              <AlertTriangle size={16} />
              <div>
                {error && <p>{error}</p>}
                {draft.storageError && (
                  <div>
                    <p>{draft.storageError}</p>
                    {draft.restoreConflict && (
                      <div>
                        <button onClick={() => draft.resolveRestore(true)}>
                          保留本地修改并同步
                        </button>
                        <button onClick={() => draft.resolveRestore(false)}>
                          使用服务端草稿
                        </button>
                        <small>选择前会备份两份草稿，避免丢失修改。</small>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        const blob = new Blob(
                          [JSON.stringify(draft.document, null, 2)],
                          { type: "application/json" },
                        );
                        const url = URL.createObjectURL(blob);
                        const a = globalThis.document.createElement("a");
                        a.href = url;
                        a.download = "人工设计草稿备份.json";
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      }}
                    >
                      备份当前草稿
                    </button>
                    <button onClick={draft.reload}>读取后端最新草稿</button>
                  </div>
                )}
                {serverCheck.issues.map((issue, index) => (
                  <p key={`server-${index}`}>建议：{issue.text}</p>
                ))}
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
        </div>
        <div className="edit-save-bar">
          <div>
            <span>
              <Check size={13} />
              {draft.storageError ? "草稿仅保存在浏览器" : draft.syncStatus}
              {draft.dirty ? " · 尚未生成此版本" : " · 与原方案一致"}
            </span>
            <small>
              {reviewing
                ? "修改后请再次对照原图确认结构"
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
                    nameEdited.current = true;
                    setName(e.target.value);
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
      </div>
    </UnitContext.Provider>
  );
}
