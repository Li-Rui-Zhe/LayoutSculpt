import { liveKey, liveObjects } from "./liveModel.js";

const types = ["furniture", "lights", "walls", "rooms", "openings"];
export function sceneObjectSignature(item, type) {
  const ignore = new Set(["name", "source_asset_id", "asset_family"]);
  // 家具位置、尺寸和朝向已有实时变换，不必为拖动制造等待提示。
  if (type === "furniture")
    [
      "x",
      "y",
      "rotation",
      "width",
      "depth",
      "height",
      "elevation",
      "room_id",
    ].forEach((k) => ignore.add(k));
  const stable = (v, top = false) => {
    if (Array.isArray(v)) return v.map((x) => stable(x));
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .filter(
            (k) =>
              !["edit_id", "edit_locked", "edit_group"].includes(k) &&
              !(top && (ignore.has(k) || k === "edit_hidden")),
          )
          .map((k) => [k, stable(v[k])]),
      );
    return v;
  };
  return JSON.stringify(stable(item, true));
}

export function pendingSceneObjects(visible, current) {
  if (!visible || !current) return [];
  return types.flatMap((type) => {
    const before = new Map(
      liveObjects(visible, type).map((item, index) => [
        liveKey(item, index),
        item,
      ]),
    );
    return liveObjects(current, type).flatMap((item, index) => {
      if (
        item.edit_hidden ||
        (type === "rooms" && item.floor_enabled === false)
      )
        return [];
      const key = liveKey(item, index),
        previous = before.get(key);
      const signature = sceneObjectSignature(item, type);
      if (
        previous &&
        !previous.edit_hidden &&
        signature === sceneObjectSignature(previous, type)
      )
        return [];
      const label = {
        furniture: "家具",
        lights: "灯具",
        walls: "墙体",
        rooms: "地板",
        openings:
          item.kind === "window"
            ? "窗户"
            : item.kind === "door"
              ? "门"
              : "通道",
      }[type];
      return [
        {
          type,
          index,
          id: item.edit_id || item.id,
          key: `${type}:${key}`,
          objectKey: key,
          signature,
          name: item.name || `${label} ${index + 1}`,
          action: previous ? "update" : "add",
          item,
        },
      ];
    });
  });
}
