import * as THREE from "three";

// 只改漫游期间的独立材质副本；共享材质、墙面与保存的模型都不受影响。
export class TourFurniture {
  constructor(model) {
    const groups = new Map();
    this.byMesh = new WeakMap();
    model.updateMatrixWorld(true);
    model.traverse((mesh) => {
      const d = mesh.userData;
      if (
        !mesh.isMesh ||
        d.architecture_network ||
        d.boundary_glass ||
        (d.furniture_index == null && !d.fixture_id)
      )
        return;
      for (let object = mesh; object; object = object.parent)
        if (!object.visible) return;
      const key =
        d.furniture_index != null
          ? `f:${d.furniture_index}`
          : `l:${d.fixture_id}`;
      if (!groups.has(key))
        groups.set(key, {
          box: new THREE.Box3(),
          roomId: d.room_id,
          name: d.furniture_name || d.asset_id || mesh.name,
          meshes: [],
          clones: new Map(),
          factor: 1,
          assigned: false,
        });
      const group = groups.get(key);
      group.box.union(new THREE.Box3().setFromObject(mesh));
      group.meshes.push({ mesh, original: mesh.material });
      this.byMesh.set(mesh, group);
    });
    this.groups = [...groups.values()];
    this.ray = new THREE.Ray();
    this.hit = new THREE.Vector3();
    this.direction = new THREE.Vector3();
  }
  targets(roomId) {
    return this.groups
      .filter(
        (g) =>
          g.roomId === roomId &&
          /沙发|sofa|床|bed|餐桌|dining|书桌|desk|电视|tv|岛台|island/i.test(
            g.name,
          ) &&
          !/床头|bedside|地毯|rug/i.test(g.name),
      )
      .map((g) => {
        const p = g.box.getCenter(new THREE.Vector3());
        return { x: p.x, y: p.z };
      });
  }
  assign(group) {
    if (group.assigned) return;
    for (const item of group.meshes) {
      const copy = (material) => {
        if (!group.clones.has(material)) {
          const clone = material.clone();
          clone.onBeforeCompile = material.onBeforeCompile;
          clone.customProgramCacheKey =
            material.customProgramCacheKey.bind(material);
          clone.transparent = true;
          clone.depthWrite = false;
          group.clones.set(material, clone);
        }
        return group.clones.get(material);
      };
      item.assigned = Array.isArray(item.original)
        ? item.original.map(copy)
        : copy(item.original);
      item.mesh.material = item.assigned;
    }
    group.assigned = true;
  }
  restore(group) {
    for (const item of group.meshes)
      if (item.mesh.material === item.assigned)
        item.mesh.material = item.original;
    group.assigned = false;
    group.factor = 1;
  }
  update(camera, now) {
    const dt =
      this.lastTime == null
        ? 1 / 60
        : Math.max(0, Math.min(0.05, (now - this.lastTime) / 1000));
    this.lastTime = now;
    camera.getWorldDirection(this.direction);
    this.ray.set(camera.position, this.direction);
    let changed = false;
    for (const group of this.groups) {
      const inside = group.box.distanceToPoint(camera.position) < 0.18;
      const hit = this.ray.intersectBox(group.box, this.hit);
      const distance = hit ? camera.position.distanceTo(hit) : Infinity;
      const target = inside
        ? 0.12
        : THREE.MathUtils.clamp((distance - 0.12) / 0.85, 0.12, 1);
      if (target === 1 && !group.assigned) continue;
      this.assign(group);
      const next =
        group.factor + (target - group.factor) * (1 - Math.exp(-dt / 0.09));
      if (Math.abs(next - group.factor) > 0.0001) changed = true;
      group.factor = Math.abs(next - target) < 0.002 ? target : next;
      for (const [original, clone] of group.clones)
        clone.opacity = original.opacity * group.factor;
      if (group.factor >= 0.998 && target === 1) {
        this.restore(group);
        changed = true;
      }
    }
    return changed;
  }
  ignoresHit(mesh) {
    return (this.byMesh.get(mesh)?.factor ?? 1) < 0.35;
  }
  dispose() {
    for (const group of this.groups) {
      this.restore(group);
      for (const clone of group.clones.values()) clone.dispose();
      group.clones.clear();
    }
    this.groups = [];
    this.byMesh = new WeakMap();
  }
}
