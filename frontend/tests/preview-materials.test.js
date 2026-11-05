import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { preparePreviewMesh } from "../src/viewer/previewLighting.js";

test("预览保留原材质与贴图，透明物不投实心黑影，纹理过滤受设备上限约束", () => {
  const renderer = { capabilities: { getMaxAnisotropy: () => 4 } };
  const material = new THREE.MeshStandardMaterial({
    color: "#b18b65",
    roughness: 0.58,
  });
  material.map = new THREE.Texture();
  material.normalMap = new THREE.Texture();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  preparePreviewMesh(mesh, renderer);
  assert.equal(mesh.material, material);
  assert.equal(material.roughness, 0.58);
  assert.equal(material.normalMap.anisotropy, 4);
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.receiveShadow, true);
  material.transparent = true;
  preparePreviewMesh(mesh, renderer);
  assert.equal(mesh.castShadow, false);
  material.transparent = false;
  const glass = new THREE.MeshPhysicalMaterial({ transmission: 1 });
  mesh.material = [material, glass];
  preparePreviewMesh(mesh, renderer);
  assert.equal(mesh.castShadow, false);
});
