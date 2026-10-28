import { doorPoseSnapshot } from "./liveDoors.js";
import { liveKey } from "./liveModel.js";
import { previewKey } from "./previewIdentity.js";

const furniturePose = [
  "x",
  "y",
  "rotation",
  "elevation",
  "room_id",
  "edit_hidden",
];
const lighting = ["lumens", "temperature", "enabled"];
const lightPose = ["x", "y", "room_id"];
const omit = (item, fields) =>
  Object.fromEntries(
    Object.entries(item).filter(([key]) => !fields.includes(key)),
  );
function patchFields(before, after, fields) {
  if (
    !after ||
    previewKey(omit(before, fields)) !== previewKey(omit(after, fields))
  )
    return before;
  return {
    ...omit(before, fields),
    ...Object.fromEntries(
      fields.filter((key) => key in after).map((key) => [key, after[key]]),
    ),
  };
}

// 只将已加载模型确实能实时表达的变动标为就绪。尺寸、款式和结构变化不能绕过建模。
export function liveSceneSnapshot(base, current, capabilities = {}) {
  const next = doorPoseSnapshot(base, current, capabilities.doorIndices || []);
  if (!next || !current) return next;
  const furnitureKeys = new Set(capabilities.furnitureKeys || []);
  const lightIds = new Set(capabilities.lightIds || []);
  const lightPoseIds = new Set(capabilities.lightPoseIds || []);
  const items = new Map(
    current.furniture.items.map((item, i) => [liveKey(item, i), item]),
  );
  const lights = new Map(current.layout.lights.map((item) => [item.id, item]));
  return {
    ...next,
    furniture: {
      ...next.furniture,
      items: next.furniture.items.map((item, i) =>
        furnitureKeys.has(liveKey(item, i))
          ? patchFields(item, items.get(liveKey(item, i)), furniturePose)
          : item,
      ),
    },
    layout: {
      ...next.layout,
      lights: next.layout.lights.map((item) =>
        lightIds.has(item.id) || lightPoseIds.has(item.id)
          ? patchFields(item, lights.get(item.id), [
              ...(lightIds.has(item.id) ? lighting : []),
              ...(lightPoseIds.has(item.id) ? lightPose : []),
            ])
          : item,
      ),
    },
  };
}

export const canSyncLiveScene = (base, current, capabilities) =>
  previewKey(liveSceneSnapshot(base, current, capabilities)) ===
  previewKey(current);
// 只用于决定是否先等已有 GLB 载入；实际完成状态仍以网格绑定成功为准。
export const mayReuseSavedScene = (base, current) =>
  !!base &&
  canSyncLiveScene(base, current, {
    doorIndices: base.layout.openings.flatMap((o, i) =>
      o.kind === "door" && o.door_leaf !== false && o.door_style !== "sliding"
        ? [i]
        : [],
    ),
    furnitureKeys: base.furniture.items.map(liveKey),
    lightIds: base.layout.lights.map((light) => light.id),
    lightPoseIds: base.layout.lights.map((light) => light.id),
  });
export const liveCapabilities = (rt) => ({
  doorIndices: [...(rt.liveDoors?.keys() || [])],
  furnitureKeys: [...(rt.liveGroups?.keys() || [])],
  lightPoseIds: [...(rt.liveLights?.keys() || [])],
  lightIds: (rt.group.children[0]?.userData.designLights || [])
    .map((fixture) => fixture.id)
    .filter(Boolean),
});
