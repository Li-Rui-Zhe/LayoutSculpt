// A single horizontal cut keeps every room boundary readable while rotating.
// The exported GLB retains full walls and openings for the complete view.
import * as THREE from "three";

export function isWallAirConditioner(data = {}) {
  const kind = data.kind || data.furniture_kind || data.builtin_kind;
  if (kind === "aircon_tower" || data.placement_surface === "floor") return false;
  if (kind === "aircon_wall") return true;
  // Older saved GLBs may only identify the appliance by its authored name.
  const name = data.name || data.furniture_name || "";
  return /空调/.test(name) && !/立式|柜式|落地/.test(name) &&
    (data.placement_surface === "wall" || /壁挂|挂壁|挂式|挂机/.test(name));
}

// Selection belongs to the editor session, never to the saved GLB or document.
const editingSelections = new WeakMap();
export function setCutawaySelection(model, furnitureGroup) {
  if (!model) return;
  if (furnitureGroup) editingSelections.set(model, furnitureGroup);
  else editingSelections.delete(model);
}

export function installCutaway(model) {
  const sources = [];
  model.traverse((obj) => {
    if (
      obj.isMesh &&
      obj.userData.cutaway_full &&
      obj.userData.cutaway_geometry
    )
      sources.push(obj);
  });
  for (const obj of sources) {
    if (obj.userData.cutaway_installed || !obj.parent) continue;
    const { positions, indices } = obj.userData.cutaway_geometry;
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    indexed.setIndex(indices);
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    const points = geometry.attributes.position.array;
    const normals = geometry.attributes.normal.array;
    const uv = new Float32Array((points.length / 3) * 2);
    for (let i = 0; i < points.length / 3; i++) {
      const offset = i * 3;
      const axis =
        Math.abs(normals[offset + 1]) > 0.9
          ? 1
          : Math.abs(normals[offset]) > 0.9
            ? 0
            : 2;
      uv[i * 2] = points[offset + (axis === 0 ? 2 : 0)] / 2;
      uv[i * 2 + 1] = points[offset + (axis === 1 ? 2 : 1)] / 2;
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const preview = new THREE.Mesh(geometry, obj.material);
    preview.name = `${obj.name}_剖切预览`;
    preview.position.copy(obj.position);
    preview.quaternion.copy(obj.quaternion);
    preview.scale.copy(obj.scale);
    preview.userData = {
      ...obj.userData,
      cutaway_full: false,
      cutaway_only: true,
    };
    delete preview.userData.cutaway_geometry;
    preview.castShadow = preview.receiveShadow = true;
    obj.parent.add(preview);
    obj.userData.cutaway_installed = true;
  }
}

export function updateCutaway(
  model,
  camera,
  { enabled = true, top = false, furnitureOnly = false } = {},
) {
  if (!model) return;
  const selectedParts = new Set();
  const selectedGroup = editingSelections.get(model);
  if (selectedGroup?.visible) selectedGroup.traverse((part) => selectedParts.add(part));
  model.traverse((obj) => {
    if (obj.userData.furniture_index != null && isWallAirConditioner(obj.userData)) {
      obj.visible = !enabled || selectedParts.has(obj);
      return;
    }
    if (furnitureOnly) return;
    if (obj.userData.cutaway_only) {
      obj.visible = enabled;
      return;
    }
    if (obj.userData.cutaway_full) {
      obj.visible = !enabled || !obj.userData.cutaway_installed;
      return;
    }
    if (!obj.userData.cutaway_upper) return;
    obj.visible = !enabled;
  });
}
