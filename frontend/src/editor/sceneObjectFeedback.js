import * as THREE from "three";
import { objectFocusBounds } from "./objectFocus.js";
import { liveKey, liveObjects } from "./liveModel.js";
import { pendingSceneObjects, sceneObjectSignature } from "./scenePending.js";

// DOM 动效不触发持续的 WebGL 重绘；镜头移动时更新锚点即可。
export function createSceneObjectFeedback(host, rt) {
  const layer = document.createElement("div");
  layer.className = "scene-object-feedback";
  layer.hidden = true;
  const summary = document.createElement("div");
  summary.className = "scene-object-summary";
  summary.setAttribute("role", "status");
  summary.setAttribute("aria-live", "polite");
  layer.append(summary);
  host.append(layer);
  const entries = new Map();
  let current,
    pending = [];
  const remove = (key) => {
    const entry = entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.element.remove();
    entries.delete(key);
    layer.hidden = !entries.size && !pending.length;
  };
  const project = () => {
    if (!current) return;
    const width = host.clientWidth,
      height = host.clientHeight;
    for (const entry of entries.values()) {
      const box = objectFocusBounds(current, entry.object, rt.liveOrigin);
      if (!box) {
        entry.element.hidden = true;
        continue;
      }
      const point = box.getCenter(new THREE.Vector3());
      point.y = Math.min(box.max.y, box.min.y + 0.8) + 0.12;
      point.project(rt.camera);
      entry.element.hidden =
        point.z < -1 ||
        point.z > 1 ||
        Math.abs(point.x) > 1 ||
        Math.abs(point.y) > 1;
      const x = Math.max(90, Math.min(width - 90, ((point.x + 1) * width) / 2));
      const y = Math.max(
        45,
        Math.min(height - 65, ((1 - point.y) * height) / 2),
      );
      entry.element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  };
  const update = (snapshot, next, phase, selected) => {
    current = next;
    pending = pendingSceneObjects(snapshot, next);
    const failed = phase === "error";
    const keys = new Set(pending.map((p) => p.key));
    for (const [key, entry] of entries) {
      if (keys.has(key)) continue;
      const latest = liveObjects(next, entry.object.type).find(
        (item, index) => liveKey(item, index) === entry.object.objectKey,
      );
      // 撤销、删除或改选另一款时直接取消，不能伪报“加载完成”。
      if (
        !latest ||
        latest.edit_hidden ||
        (entry.object.type === "rooms" && latest.floor_enabled === false) ||
        sceneObjectSignature(latest, entry.object.type) !==
          entry.object.signature
      ) {
        remove(key);
        continue;
      }
      if (entry.timer) continue;
      entry.element.dataset.state = "done";
      entry.detail.textContent = "已就绪";
      entry.timer = setTimeout(() => remove(key), 850);
    }
    const prioritized = [...pending].sort(
      (a, b) =>
        Number(b.type === selected?.type && b.index === selected?.index) -
        Number(a.type === selected?.type && a.index === selected?.index),
    );
    const displayed = new Set(prioritized.slice(0, 5).map((p) => p.key));
    for (const object of pending) {
      if (!displayed.has(object.key)) {
        remove(object.key);
        continue;
      }
      let entry = entries.get(object.key);
      if (!entry) {
        const element = document.createElement("div");
        element.className = "scene-object-label";
        const title = document.createElement("b"),
          detail = document.createElement("span"),
          rail = document.createElement("i");
        rail.className = "object-loading-rail";
        rail.setAttribute("aria-hidden", "true");
        element.append(title, detail, rail);
        layer.append(element);
        entry = { element, title, detail };
        entries.set(object.key, entry);
      }
      clearTimeout(entry.timer);
      entry.timer = null;
      entry.object = object;
      entry.title.textContent = object.name;
      entry.element.dataset.state = failed ? "error" : "loading";
      const room = next.layout.rooms.find(
        (r) => r.id === object.item.room_id,
      )?.name;
      entry.detail.textContent = failed
        ? "暂未完成 · 可重新同步"
        : object.action === "add"
          ? `正在${phase === "loading" ? "载入" : "放入"}${room ? ` · ${room}` : " · 位置已确定"}`
          : object.type === "furniture"
            ? "正在换款 · 暂留原件"
            : "正在更新细节";
    }
    layer.hidden = !entries.size && !pending.length;
    summary.hidden = !pending.length;
    const message = failed
      ? `${pending.length} 个对象暂未完成，设计已保留`
      : `${pending.length} 个对象正在更新 · 完成后自动显示`;
    if (summary.textContent !== message) summary.textContent = message;
    project();
  };
  return {
    update,
    project,
    dispose() {
      for (const key of entries.keys()) remove(key);
      layer.remove();
    },
  };
}
