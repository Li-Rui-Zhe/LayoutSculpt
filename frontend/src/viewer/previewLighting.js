import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { environmentTarget } from "./environment.js";

// 素材、DIY 和人工设计共用展示页的色调响应；阴影只在单件预览中启用。
export function createPreviewLighting(
  renderer,
  scene,
  { shadows = false } = {},
) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  const ambient = new THREE.HemisphereLight();
  const light = new THREE.DirectionalLight();
  const fill = new THREE.DirectionalLight();
  light.position.set(3, 6, -4);
  fill.position.set(-4, 3, 4);
  light.castShadow = shadows;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.normalBias = 0.006;
  light.shadow.bias = -0.0001;
  light.shadow.radius = 2;
  scene.add(ambient, light, light.target, fill);
  const ground = shadows
    ? new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShadowMaterial({ opacity: 0.18, depthWrite: false }),
      )
    : null;
  if (ground) {
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }
  return {
    light,
    ambient,
    apply(night = false) {
      const target = environmentTarget(night ? "night" : "midday");
      ambient.color.copy(target.sky);
      ambient.groundColor.copy(target.bounce);
      ambient.intensity = target.ambient;
      light.color.copy(target.sunColor);
      light.intensity = target.sun;
      fill.color.copy(target.fillColor);
      fill.intensity = target.fill;
      scene.background = target.background.clone();
      scene.environmentIntensity = target.environment;
      renderer.toneMappingExposure = target.exposure;
      renderer.shadowMap.needsUpdate = shadows;
    },
    fit(group) {
      if (!ground) return;
      const bounds = new THREE.Box3().setFromObject(group);
      if (bounds.isEmpty()) return;
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const radius = Math.max(0.3, size.length() * 0.65);
      light.target.position.copy(center);
      const side = Math.sign(light.position.z) || -1;
      light.position
        .copy(center)
        .add(new THREE.Vector3(1, 2, side * 1.5).multiplyScalar(radius));
      Object.assign(light.shadow.camera, {
        left: -radius,
        right: radius,
        top: radius,
        bottom: -radius,
        near: 0.01,
        far: radius * 7,
      });
      light.shadow.camera.updateProjectionMatrix();
      ground.position.set(center.x, bounds.min.y - 0.008, center.z);
      ground.scale.setScalar(radius * 8);
      renderer.shadowMap.needsUpdate = true;
    },
    dispose() {
      scene.environment = null;
      environment.dispose();
      light.shadow.dispose();
      scene.remove(ambient, light, light.target, fill);
      if (ground) {
        scene.remove(ground);
        ground.geometry.dispose();
        ground.material.dispose();
      }
    },
  };
}

export function preparePreviewMesh(mesh, renderer) {
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  mesh.castShadow = materials.every((m) => !m.transparent && !m.transmission);
  mesh.receiveShadow = true;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const material of materials)
    for (const key of ["map", "normalMap", "roughnessMap"])
      if (material[key]) material[key].anisotropy = anisotropy;
}
