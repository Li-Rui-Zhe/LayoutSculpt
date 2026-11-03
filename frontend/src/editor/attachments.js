// 按稳定对象 ID 联动；新绑定保持当前位置，解除或删除父物体也不改变位置。
const poseKeys = ["x", "y", "elevation", "rotation"];
const unchangedPose = (a, b) =>
  poseKeys.every((k) => (a[k] || 0) === (b[k] || 0));

export function attachmentError(document) {
  const items = document.furniture.items;
  const byId = new Map(items.map((item) => [item.edit_id, item]));
  for (const item of [
    ...items,
    ...(document.layout.presentation_layers || []),
  ]) {
    let id = item.parent_furniture_id;
    const seen = new Set(item.edit_id ? [item.edit_id] : []);
    while (id) {
      if (seen.has(id)) return "联动关系不能形成循环。";
      seen.add(id);
      const parent = byId.get(id);
      if (!parent) return "联动的家具已不存在，请解除后重新选择。";
      id = parent.parent_furniture_id;
    }
  }
  return "";
}

export function followAttachments(previous, changed) {
  if (
    ![
      ...changed.furniture.items,
      ...(changed.layout.presentation_layers || []),
    ].some((item) => item.parent_furniture_id)
  )
    return changed;
  const next = structuredClone(changed);
  const old = new Map(
    previous.furniture.items.map((item) => [item.edit_id, item]),
  );
  const current = new Map(
    next.furniture.items.map((item) => [item.edit_id, item]),
  );
  for (const item of [
    ...next.furniture.items,
    ...(next.layout.presentation_layers || []),
  ]) {
    if (item.parent_furniture_id && !current.has(item.parent_furniture_id))
      item.parent_furniture_id = null;
  }
  const problem = attachmentError(next);
  if (problem) throw Error(problem);
  const done = new Set();
  const follow = (item, before) => {
    const id = item.parent_furniture_id;
    if (
      !id ||
      before?.parent_furniture_id !== id ||
      !unchangedPose(before, item)
    )
      return;
    const parent = current.get(id),
      prior = old.get(id);
    visit(parent);
    if (!prior) return;
    const angle =
      (((parent.rotation || 0) - (prior.rotation || 0)) * Math.PI) / 180;
    const dx = before.x - prior.x,
      dy = before.y - prior.y;
    item.x = parent.x + dx * Math.cos(angle) - dy * Math.sin(angle);
    item.y = parent.y + dx * Math.sin(angle) + dy * Math.cos(angle);
    item.rotation =
      ((((before.rotation || 0) + (angle * 180) / Math.PI) % 360) + 360) % 360;
    // 物品放在父家具顶面时随顶面升降；孩子的自身尺寸保持不变。
    const onTop =
      (before.elevation || 0) >= (prior.elevation || 0) + prior.height - 0.08;
    item.elevation =
      (before.elevation || 0) +
      (parent.elevation || 0) -
      (prior.elevation || 0) +
      (onTop ? parent.height - prior.height : 0);
    if (item.room_id) item.room_id = parent.room_id;
  };
  const visit = (item) => {
    if (!item || done.has(item.edit_id)) return;
    done.add(item.edit_id);
    follow(item, old.get(item.edit_id));
  };
  next.furniture.items.forEach(visit);
  const oldLayers = new Map(
    (previous.layout.presentation_layers || []).map((item) => [item.id, item]),
  );
  for (const layer of next.layout.presentation_layers || [])
    follow(layer, oldLayers.get(layer.id));
  return next;
}

export function parentOptions(document, item) {
  return document.furniture.items.filter((candidate) => {
    if (!candidate.edit_id || candidate.edit_id === item.edit_id) return false;
    let parent = candidate;
    const seen = new Set();
    while (parent?.parent_furniture_id) {
      if (
        parent.parent_furniture_id === item.edit_id ||
        seen.has(parent.edit_id)
      )
        return false;
      seen.add(parent.edit_id);
      parent = document.furniture.items.find(
        (f) => f.edit_id === parent.parent_furniture_id,
      );
    }
    return true;
  });
}
