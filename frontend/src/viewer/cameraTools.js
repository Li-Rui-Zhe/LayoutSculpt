import * as THREE from "three";

export function cameraState(scene) {
  return {
    position: scene.camera.position.toArray(),
    target: scene.controls.target.toArray(),
    zoom: scene.camera.zoom,
    top: scene.topView,
    fov: scene.camera.fov,
    indoor: scene.controls.minDistance < 1,
  };
}
export function restoreCamera(scene, value) {
  if (
    !value ||
    ![...(value.position || []), ...(value.target || []), value.zoom].every(
      Number.isFinite,
    ) ||
    value.position?.length !== 3 ||
    value.target?.length !== 3
  )
    return false;
  scene.reset(!!value.top);
  if (value.indoor) {
    scene.camera.fov = value.fov || 65;
    scene.controls.minDistance = 0.1;
    scene.controls.maxPolarAngle = Math.PI * 0.9;
  }
  scene.controls.cursor.copy(new THREE.Vector3(...value.target));
  scene.camera.position.fromArray(value.position);
  scene.controls.target.fromArray(value.target);
  scene.camera.zoom = value.zoom;
  scene.camera.updateProjectionMatrix();
  scene.controls.update();
  scene.dirty = true;
  return true;
}
export function focusRoom(scene, id, inside = false) {
  const bounds = new THREE.Box3();
  scene.model?.updateMatrixWorld(true);
  scene.model?.traverse((o) => {
    if (
      o.isMesh &&
      o.userData.structure_kind === "room" &&
      o.userData.room_id === id
    )
      bounds.expandByObject(o);
  });
  if (bounds.isEmpty()) return false;
  scene.reset(false);
  const center = bounds.getCenter(new THREE.Vector3()),
    size = bounds.getSize(new THREE.Vector3());
  scene.controls.autoRotate = false;
  scene.controls.cursor.copy(center);
  scene.controls.maxTargetRadius = Math.max(size.x, size.z) * 2;
  scene.controls.target.copy(center);
  if (inside) {
    scene.perspectiveCamera.fov = 65;
    scene.perspectiveCamera.near = 0.02;
    scene.controls.minDistance = 0.1;
    scene.controls.maxPolarAngle = Math.PI * 0.9;
    scene.controls.target.y = bounds.max.y + 1.5;
    scene.camera.position
      .copy(scene.controls.target)
      .add(new THREE.Vector3(0, 0, Math.max(0.3, Math.min(1, size.z * 0.3))));
  } else
    scene.camera.position
      .copy(center)
      .add(
        new THREE.Vector3(1, 1.5, 1.7)
          .normalize()
          .multiplyScalar(Math.max(size.x, size.z) * 3.5),
      );
  scene.camera.updateProjectionMatrix();
  scene.controls.update();
  scene.dirty = true;
  return true;
}

export function estimatedModelBytes(root) {
  const visited = new Set();
  let total = 0;
  root?.traverse((o) => {
    if (o.geometry && !visited.has(o.geometry)) {
      visited.add(o.geometry);
      for (const a of Object.values(o.geometry.attributes))
        total += a.array.byteLength;
      total += o.geometry.index?.array.byteLength || 0;
    }
    for (const m of [o.material].flat().filter(Boolean))
      for (const texture of Object.values(m)) {
        if (texture?.isTexture && !visited.has(texture)) {
          visited.add(texture);
          const image = texture.image;
          total += (image?.width || 0) * (image?.height || 0) * 4 * 1.33;
        }
      }
  });
  return total;
}
