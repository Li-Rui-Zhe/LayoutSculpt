import * as THREE from "three";

export const planOrigin = (doc) => {
  const points = doc.layout.outline;
  return {
    x:
      (Math.min(...points.map((p) => p.x)) +
        Math.max(...points.map((p) => p.x))) /
      2,
    y:
      (Math.min(...points.map((p) => p.y)) +
        Math.max(...points.map((p) => p.y))) /
      2,
  };
};
export const liveObjects = (doc, type) =>
  type === "furniture" ? doc.furniture.items : doc.layout[type] || [];
export const liveKey = (item, index) =>
  item.edit_id || item.id || String(index);

export function selectionFromHit(data, snapshot, current) {
  if (data.live_selection) {
    const { type, key } = data.live_selection;
    const index = liveObjects(current, type).findIndex(
      (v, i) => liveKey(v, i) === key,
    );
    return index >= 0 ? { type, index } : null;
  }
  let type, item, index;
  if (data.furniture_index != null) {
    type = "furniture";
    index = data.furniture_index;
  } else if (data.opening_index != null) {
    type = "openings";
    index = data.opening_index;
  } else if (data.fixture_id || data.fixture_owner_id) {
    type = "lights";
    index = snapshot.layout.lights.findIndex(
      (v) => v.id === (data.fixture_id || data.fixture_owner_id),
    );
  } else if (data.wall_id || data.wall_ids?.length) {
    type = "walls";
    const ids = data.wall_id ? [data.wall_id] : data.wall_ids;
    let candidates = snapshot.layout.walls
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => ids.includes(v.id));
    if (data.point) {
      const distance = ({ v }) => {
        const dx = v.end.x - v.start.x,
          dy = v.end.y - v.start.y;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((data.point.x - v.start.x) * dx +
              (data.point.y - v.start.y) * dy) /
              (dx * dx + dy * dy),
          ),
        );
        return Math.hypot(
          data.point.x - v.start.x - t * dx,
          data.point.y - v.start.y - t * dy,
        );
      };
      candidates.sort((a, b) => distance(a) - distance(b));
    }
    index = candidates[0]?.i;
  } else if (data.room_id) {
    type = "rooms";
    index = snapshot.layout.rooms.findIndex((v) => v.id === data.room_id);
  }
  if (!type || !(item = liveObjects(snapshot, type)[index])) return null;
  const key = liveKey(item, index);
  const found = liveObjects(current, type).findIndex(
    (v, i) => liveKey(v, i) === key,
  );
  return found >= 0 ? { type, index: found } : null;
}

// 将一个家具的所有网格放到同一个真实米制枢轴下，变换不重建 WebGL 或模型。
export function bindLiveFurniture(model, snapshot) {
  const origin = planOrigin(snapshot),
    groups = new Map(),
    meshes = [];
  model.updateMatrixWorld(true);
  model.traverse((node) => {
    if (node.userData.furniture_index != null) meshes.push(node);
  });
  for (const node of meshes) {
    // glTF extras 可能同时在父组和网格上出现，避免重复挂载。
    if (node.parent?.userData.furniture_index != null) continue;
    const index = node.userData.furniture_index,
      source = snapshot.furniture.items[index];
    if (!source) continue;
    const key = liveKey(source, index);
    let pivot = groups.get(key);
    if (!pivot) {
      pivot = new THREE.Group();
      pivot.position.set(
        source.x - origin.x,
        (source.elevation || 0) + 0.035,
        source.y - origin.y,
      );
      pivot.rotation.y = -THREE.MathUtils.degToRad(source.rotation);
      pivot.userData.liveFurniture = { key, source, origin };
      model.add(pivot);
      pivot.updateMatrixWorld(true);
      groups.set(key, pivot);
    }
    pivot.attach(node);
  }
  return groups;
}

export function syncLiveFurniture(groups, document) {
  const items = new Map(
    document.furniture.items.map((v, i) => [liveKey(v, i), v]),
  );
  for (const [key, pivot] of groups) {
    const value = items.get(key),
      { source, origin } = pivot.userData.liveFurniture;
    pivot.visible = !!value && !value.edit_hidden;
    if (!value) continue;
    pivot.position.set(
      value.x - origin.x,
      (value.elevation || 0) + 0.035,
      value.y - origin.y,
    );
    pivot.rotation.y = -THREE.MathUtils.degToRad(value.rotation);
    pivot.scale.set(
      value.width / source.width,
      value.height / source.height,
      value.depth / source.depth,
    );
    pivot.updateMatrixWorld(true);
  }
}

export function installEditProxies(model, document) {
  const origin = planOrigin(document);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  document.layout.openings.forEach((o, index) => {
    const wall = document.layout.walls.find((w) => w.id === o.wall_id);
    if (!wall) return;
    const dx = wall.end.x - wall.start.x,
      dy = wall.end.y - wall.start.y,
      len = Math.hypot(dx, dy),
      at = (o.offset + o.width / 2) / len;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(o.width, o.height, wall.thickness),
      material,
    );
    mesh.position.set(
      wall.start.x + dx * at - origin.x,
      o.bottom + o.height / 2,
      wall.start.y + dy * at - origin.y,
    );
    mesh.rotation.y = -Math.atan2(dy, dx);
    mesh.userData = {
      opening_index: index,
      wall_id: wall.id,
      editor_proxy: true,
    };
    model.add(mesh);
  });
  for (const fixture of document.layout.lights || []) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 8),
      material,
    );
    mesh.position.set(
      fixture.x - origin.x,
      fixture.elevation,
      fixture.y - origin.y,
    );
    mesh.userData = { fixture_id: fixture.id, editor_proxy: true };
    model.add(mesh);
  }
}
