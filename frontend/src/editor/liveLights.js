import * as THREE from "three";

// 只绑定带完整归属标记的灯具；旧模型不能只挪灯泡、留下灯罩。
export function bindLiveLights(model, document) {
  const groups = new Map();
  const nodes = [];
  model.traverse((node) => nodes.push(node));
  for (const source of document.layout.lights) {
    const owned = nodes.filter((node) => node.userData.fixture_owner_id === source.id);
    if (!owned.some((node) => node.userData.fixture_id === source.id)) continue;
    const pivot = new THREE.Group();
    pivot.userData.liveLight = { source };
    model.add(pivot);
    model.updateMatrixWorld(true);
    const members = new Set(owned);
    for (const node of nodes) {
      if (node.userData.editor_proxy && node.userData.fixture_id === source.id)
        members.add(node);
    }
    for (const fixture of model.userData.designLights || []) {
      if (fixture.id !== source.id) continue;
      members.add(fixture.light);
      if (fixture.light.target) members.add(fixture.light.target);
    }
    for (const node of members) {
      let ancestor = node.parent;
      while (ancestor && !members.has(ancestor)) ancestor = ancestor.parent;
      if (!ancestor) pivot.attach(node);
    }
    groups.set(source.id, pivot);
  }
  return groups;
}

export function syncLiveLights(groups, document) {
  const current = new Map(document.layout.lights.map((item) => [item.id, item]));
  for (const [id, pivot] of groups || []) {
    const value = current.get(id);
    if (!value) continue;
    const { source } = pivot.userData.liveLight;
    // 离地高度可能改变灯杆/吊线几何，仍交给正式建模器；平移则完全等价。
    pivot.position.set(value.x - source.x, 0, value.y - source.y);
    pivot.updateMatrixWorld(true);
  }
}
