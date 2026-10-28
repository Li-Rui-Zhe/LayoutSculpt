import { changeBoundary } from "../editor/balcony.js";
import {
  openingPosition,
  validateOpening,
} from "../editor/openingPlacement.js";

export const architectureCategories = [
  ["all", "全部构件"],
  ["墙体", "墙体"],
  ["门", "门"],
  ["窗", "窗"],
  ["通道", "通道"],
  ["阳台", "阳台围护"],
];

export const architectureItems = [
  {
    id: "wall",
    name: "普通实墙",
    sub: "室内隔墙 · 阳台侧墙",
    height: 2.7,
    thickness: 0.16,
    sill_height: 0,
    category: "墙体",
    description: "保留完整墙体，适合室内分隔和阳台两侧实墙。",
  },
  {
    id: "parapet",
    name: "实体低栏板",
    sub: "开放阳台 · 实体围护",
    height: 1.1,
    thickness: 0.16,
    sill_height: 0,
    category: "阳台",
    description: "低矮实体栏板，保留阳台外缘的开放视野。",
  },
  {
    id: "glass_railing",
    name: "阳台玻璃栏板",
    sub: "低基座 · 清透玻璃 · 细框",
    height: 1.1,
    thickness: 0.1,
    sill_height: 0.15,
    category: "阳台",
    description: "低基座配透明玻璃和细金属框，适合开放阳台外缘。",
  },
  {
    id: "glazing",
    name: "阳台封窗玻璃",
    sub: "完整封窗 · 可调窗下墙",
    height: 2.7,
    thickness: 0.1,
    sill_height: 0.6,
    category: "阳台",
    description: "完整高度的玻璃围护，可分别调整总高和下方实体窗下墙。",
  },
];

architectureItems.push(
  {
    id: "low_partition",
    boundary_type: "parapet",
    name: "半高隔墙",
    sub: "空间分隔 · 半高实体墙",
    category: "墙体",
    height: 1.2,
    thickness: 0.12,
    sill_height: 0,
    description: "半高实体隔墙，可按实际高度调整，用于空间分区。",
  },
  {
    id: "glass_partition",
    boundary_type: "glazing",
    name: "落地玻璃隔断",
    sub: "通透分隔 · 无实体基座",
    category: "墙体",
    height: 2.7,
    thickness: 0.08,
    sill_height: 0,
    description: "落地透明玻璃配细框，按选中墙段长度适配。",
  },
  ...[
    [
      "single_door",
      "单开平开门",
      "单扇木门 · 可调开向",
      "门",
      {
        kind: "door",
        width: 0.9,
        height: 2.1,
        bottom: 0,
        door_style: "hinged",
        door_material: "wood",
        angle: 75,
      },
    ],
    [
      "double_door",
      "双开平开门",
      "对开双门扇 · 对称开启",
      "门",
      {
        kind: "door",
        width: 1.6,
        height: 2.2,
        bottom: 0,
        door_style: "double",
        door_material: "wood",
        angle: 60,
      },
    ],
    [
      "sliding_door",
      "双扇玻璃移门",
      "阳台 / 厨房 · 双轨玻璃门",
      "门",
      {
        kind: "door",
        width: 1.8,
        height: 2.3,
        bottom: 0,
        door_style: "sliding",
        door_material: "glass",
        angle: 0,
      },
    ],
    [
      "bathroom_door",
      "卫生间窄门",
      "紧凑单扇 · 独立门洞",
      "门",
      {
        kind: "door",
        width: 0.75,
        height: 2.1,
        bottom: 0,
        door_style: "hinged",
        door_material: "wood",
        angle: 60,
      },
    ],
    [
      "fixed_window",
      "固定玻璃窗",
      "固定窗框 · 清透玻璃",
      "窗",
      {
        kind: "window",
        width: 1.2,
        height: 1.4,
        bottom: 0.9,
        window_style: "fixed",
      },
    ],
    [
      "casement_window",
      "双扇平开窗",
      "独立窗扇 · 边框与把手",
      "窗",
      {
        kind: "window",
        width: 1.2,
        height: 1.4,
        bottom: 0.9,
        window_style: "casement",
      },
    ],
    [
      "sliding_window",
      "双扇推拉窗",
      "双轨错层 · 可调窗台",
      "窗",
      {
        kind: "window",
        width: 1.6,
        height: 1.4,
        bottom: 0.9,
        window_style: "sliding",
      },
    ],
    [
      "full_height_window",
      "落地固定窗",
      "低窗台 · 大面积采光",
      "窗",
      {
        kind: "window",
        width: 1.8,
        height: 2.4,
        bottom: 0.1,
        window_style: "fixed",
      },
    ],
    [
      "frosted_window",
      "卫生间磨砂窗",
      "小窗 · 磨砂玻璃",
      "窗",
      {
        kind: "window",
        width: 0.6,
        height: 0.8,
        bottom: 1.4,
        window_style: "fixed",
        glass_type: "frosted",
      },
    ],
    [
      "doorway",
      "标准无门扇门洞",
      "仅开门洞 · 无门扇",
      "通道",
      { kind: "passage", width: 0.9, height: 2.1, bottom: 0 },
    ],
    [
      "wide_passage",
      "宽开放通道",
      "客餐厅连接 · 无门扇",
      "通道",
      { kind: "passage", width: 2.4, height: 2.4, bottom: 0 },
    ],
  ].map(([id, name, sub, category, opening]) => ({
    id,
    name,
    sub,
    category,
    opening,
    height: opening.height,
    thickness: 0.16,
    sill_height: 0,
    description: `${name}安装于选中墙段，宽高、位置及开启参数可在应用前调整。`,
  })),
);

export const architecturePreset = (configuration) =>
  architectureItems.find(
    (item) =>
      item.id === (configuration.preset_id || configuration.boundary_type),
  );

export function openingReference(opening) {
  return Object.fromEntries(
    ["edit_id", "wall_id", "kind", "offset", "width", "height", "bottom"]
      .filter((k) => opening[k] !== undefined)
      .map((k) => [k, opening[k]]),
  );
}

function replacementIndex(document, reference) {
  if (!reference) return -1;
  const indices = document.layout.openings.flatMap((o, i) =>
    (
      reference.edit_id
        ? o.edit_id === reference.edit_id
        : ["wall_id", "kind", "offset", "width", "height", "bottom"].every(
            (k) => o[k] === reference[k],
          )
    )
      ? [i]
      : [],
  );
  if (indices.length !== 1)
    throw Error("原开口已变化或不存在，请重新选择要替换的门窗。");
  return indices[0];
}

export function architectureOpening(document, wallId, configuration) {
  const preset = architecturePreset(configuration);
  if (!preset?.opening) throw Error("请选择门、窗或通道构件。");
  const index = replacementIndex(document, configuration.opening_ref);
  const layout = {
    ...document.layout,
    openings: document.layout.openings.filter((_, i) => i !== index),
  };
  const wall = layout.walls.find((w) => w.id === wallId);
  const opening = {
    door_leaf: true,
    hinge: "start",
    swing: "left",
    angle: 90,
    door_style: "hinged",
    door_material: "wood",
    window_style: "fixed",
    glass_type: "clear",
    ...preset.opening,
    wall_id: wallId,
  };
  for (const key of ["width", "height", "bottom", "angle", "hinge", "swing"])
    if (configuration[key] !== undefined) opening[key] = configuration[key];
  if (opening.kind !== "window") opening.bottom = 0;
  opening.offset =
    configuration.offset === undefined
      ? openingPosition(layout, wall, opening.width)
      : configuration.offset;
  return { opening, index, layout, wall };
}

export function applyArchitecture(document, wallId, configuration) {
  const preset = architecturePreset(configuration);
  if (!preset) throw Error("请选择有效的建筑构件。");
  const index = document.layout.walls.findIndex((wall) => wall.id === wallId);
  if (index < 0) throw Error("目标墙段已不存在，请重新选择。");
  if (preset.opening) {
    const {
      opening,
      index: replace,
      layout,
      wall,
    } = architectureOpening(document, wallId, configuration);
    if (wall.edit_locked || wall.load_bearing)
      throw Error("安装墙段已锁定或标记为承重结构，请先核对后再编辑。");
    if (replace >= 0 && document.layout.openings[replace].wall_id !== wallId)
      throw Error("替换门窗须选择其原安装墙段。");
    if (replace >= 0 && document.layout.openings[replace].edit_locked)
      throw Error("此门窗或通道已锁定，请先解锁。");
    const errors = validateOpening(layout, opening);
    if (errors.length) throw Error(errors[0]);
    if (
      !["hinged", "double", "sliding"].includes(opening.door_style) ||
      !["start", "end"].includes(opening.hinge) ||
      !["left", "right"].includes(opening.swing)
    )
      throw Error("门扇样式或开启方向无效。");
    const next = structuredClone(document);
    if (replace >= 0)
      next.layout.openings[replace] = {
        ...next.layout.openings[replace],
        ...opening,
      };
    else
      next.layout.openings.push({
        ...opening,
        edit_id: globalThis.crypto.randomUUID(),
      });
    return next;
  }
  return changeBoundary(document, index, preset.boundary_type || preset.id, {
    height: configuration.height ?? preset.height,
    thickness: configuration.thickness ?? preset.thickness,
    sill_height: configuration.sill_height ?? preset.sill_height,
  });
}

export function architectureSelection(before, after, wallId, configuration) {
  if (!architecturePreset(configuration)?.opening)
    return {
      type: "walls",
      index: after.layout.walls.findIndex((w) => w.id === wallId),
    };
  const replace = replacementIndex(before, configuration.opening_ref);
  return {
    type: "openings",
    index: replace >= 0 ? replace : after.layout.openings.length - 1,
  };
}
