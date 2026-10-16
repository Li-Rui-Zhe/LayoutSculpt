import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  applyOptics,
  opticalProfile,
  upgradeSurfaceMaterials,
} from "../src/materials/optics.js";
import { materials } from "../src/catalog.js";
import { StudioScene } from "../src/viewer/StudioScene.js";
import { initialStudio } from "../src/hooks/useStudio.js";
import { sourceRecipe, restoreSurfaces } from "../src/diy/surfaceWorkspace.js";

test("共享墙材质升级保留贴图，切换玻璃和普通材质恢复光学参数与投影", () => {
  const model = new THREE.Group();
  const standard = new THREE.MeshStandardMaterial({
    name: "墙面_素材_wall-matte",
    map: new THREE.Texture(),
  });
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), standard);
    mesh.castShadow = true;
    model.add(mesh);
  }
  upgradeSurfaceMaterials(model);
  const material = model.children[0].material;
  assert.equal(material, model.children[1].material);
  assert.ok(material.isMeshPhysicalMaterial);
  assert.ok("PHYSICAL" in material.defines);
  assert.equal(material.map, standard.map);
  const snapshot = {
    material,
    color: material.color.clone(),
    map: material.map,
    normalMap: null,
    normalScale: material.normalScale.clone(),
    roughness: material.roughness,
    metalness: material.metalness,
    optics: opticalProfile(material),
  };
  const engine = Object.assign(Object.create(StudioScene.prototype), {
    model,
    originals: new Map([[material.uuid, snapshot]]),
    light() {},
    surfaceTexture() {
      return null;
    },
  });
  const id = "texture:" + "c".repeat(64);
  const item = {
    id,
    type: "walls",
    color: "#ffffff",
    roughness: 0.03,
    optics: { transmission: 0.95, metalness: 0, ior: 1.5, thickness: 0.01 },
  };
  materials.push(item);
  try {
    engine.apply({
      ...initialStudio,
      selected: { ...initialStudio.selected, walls: id },
    });
    assert.equal(material.transmission, 0.95);
    assert.equal(material.roughness, 0.03);
    assert.equal(model.children[0].castShadow, false);
    engine.apply(initialStudio);
    assert.equal(material.transmission, 0);
    assert.equal(model.children[0].castShadow, true);
    applyOptics(material, { metalness: 1 });
    assert.equal(material.metalness, 1);
    assert.equal(material.transmission, 0);
  } finally {
    materials.splice(materials.indexOf(item), 1);
  }
});

test("玻璃草稿保留高光与光学参数，新普通结果不会继承透光", () => {
  const bases = [{ id: "wall-matte", name: "墙面", color: "#ffffff" }];
  const initial = restoreSurfaces("walls", bases);
  initial.drafts.ai = {
    ...initial.drafts.ai,
    base_id: "source:" + "a".repeat(64),
    roughness: 0.03,
    optics: { transmission: 0.95, metalness: 0, ior: 1.5, thickness: 0.01 },
  };
  const restored = restoreSurfaces("walls", bases, initial);
  assert.equal(restored.drafts.ai.optics.transmission, 0.95);
  assert.equal(
    sourceRecipe(restored.drafts.ai, {
      id: "source:" + "b".repeat(64),
      origin: "ai",
    }).optics,
    null,
  );
  initial.drafts.ai.optics.ior = -1;
  assert.equal(restoreSurfaces("walls", bases, initial).drafts.ai.base_id, "");
});
