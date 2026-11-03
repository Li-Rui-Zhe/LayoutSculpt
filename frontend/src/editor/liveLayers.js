import * as THREE from "three";
import { planOrigin } from "./liveModel.js";

export function bindLiveLayers(model, document) {
  const groups = new Map(),
    origin = planOrigin(document),
    nodes = [];
  const sources = new Map(
    (document.layout.presentation_layers || []).map((layer) => [
      layer.id,
      layer,
    ]),
  );
  model.updateMatrixWorld(true);
  model.traverse((node) => {
    if (node.userData.presentation_layer_id) nodes.push(node);
  });
  for (const node of nodes) {
    if (node.parent?.userData.presentation_layer_id) continue;
    const id = node.userData.presentation_layer_id,
      layer = sources.get(id);
    if (!layer) continue;
    let pivot = groups.get(id);
    if (!pivot) {
      pivot = new THREE.Group();
      pivot.userData.layerOrigin = origin;
      pivot.position.set(
        layer.x - origin.x,
        layer.elevation,
        layer.y - origin.y,
      );
      pivot.rotation.y = -THREE.MathUtils.degToRad(layer.rotation || 0);
      model.add(pivot);
      pivot.updateMatrixWorld(true);
      groups.set(id, pivot);
    }
    pivot.attach(node);
  }
  return groups;
}
export function syncLiveLayers(groups, document) {
  const layers = new Map(
    (document.layout.presentation_layers || []).map((layer) => [
      layer.id,
      layer,
    ]),
  );
  for (const [id, pivot] of groups || []) {
    const value = layers.get(id),
      origin = pivot.userData.layerOrigin;
    pivot.visible = !!value && value.visible !== false;
    if (!value) continue;
    pivot.position.set(value.x - origin.x, value.elevation, value.y - origin.y);
    pivot.rotation.y = -THREE.MathUtils.degToRad(value.rotation || 0);
    pivot.updateMatrixWorld(true);
  }
}
