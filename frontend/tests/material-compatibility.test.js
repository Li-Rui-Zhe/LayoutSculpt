import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { repairLegacyWallMaterials } from "../src/viewer/materialCompatibility.js";
import { installCutaway } from "../src/viewer/cutaway.js";

test("旧乳胶漆恢复非金属漫反射，完整和剖切墙共用修复结果", () => {
  const model = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: "#d6c7a8",
    metalness: 1,
    roughness: 0.75,
  });
  material.name = "墙面_微调_cream";
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.2), material);
  const cut = new THREE.BoxGeometry(2, 1.2, 0.2);
  wall.userData = {
    cutaway_full: true,
    cutaway_geometry: {
      positions: Array.from(cut.attributes.position.array),
      indices: Array.from(cut.index.array),
    },
  };
  model.add(wall);
  repairLegacyWallMaterials(model);
  installCutaway(model);
  assert.equal(material.metalness, 0);
  assert.equal(material.color.getHexString(), "d6c7a8");
  assert.equal(model.children[1].material.metalness, 0);
  repairLegacyWallMaterials(model);
  assert.equal(material.roughness, 0.75);
});

test("保留真实金属和自定义墙面的原有属性", () => {
  const model = new THREE.Group();
  for (const name of ["金属_拉丝黄铜", "墙面_素材_metal", "用户自定义墙面"]) {
    const material = new THREE.MeshStandardMaterial({ metalness: 1 });
    material.name = name;
    model.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  }
  repairLegacyWallMaterials(model);
  model.children.forEach((m) => assert.equal(m.material.metalness, 1));
});
