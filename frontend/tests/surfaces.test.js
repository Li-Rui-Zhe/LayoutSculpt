import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import * as THREE from "three";
import { materials, materialCategories } from "../src/catalog.js";
import {
  surfaceProfile,
  isolateSoftSurfaces,
} from "../src/materials/surfaces.js";
import { StudioScene } from "../src/viewer/StudioScene.js";
import { materialSelection } from "../src/materials/assignments.js";
import { initialStudio } from "../src/hooks/useStudio.js";

test("装修样板分类独立且纹理文件齐全，旧配色不再出现在选材列表", () => {
  for (const [category, ids] of Object.entries(materialCategories)) {
    for (const id of ids) {
      const sample = materials.find((m) => m.id === id);
      assert.ok(sample && !sample.legacy);
      assert.equal(sample.type, category);
      const profiles = sample.scheme
        ? Object.values(sample.scheme)
        : [surfaceProfile(sample, category)];
      for (const profile of profiles) {
        assert.ok(profile.roughness >= 0 && profile.roughness <= 1);
        for (const channel of ["color", "normal"]) {
          assert.ok(
            existsSync(
              new URL(
                `../../public/materials/${profile.surface}_${channel}.png`,
                import.meta.url,
              ),
            ),
            `${id} 缺少 ${channel} 贴图`,
          );
        }
      }
    }
  }
});

test("软装按用途拆分共用材质，真实应用纹理与粗糙度，画作不变且可还原", () => {
  const model = new THREE.Group();
  const original = new THREE.MeshStandardMaterial({
    name: "软装_织物",
    color: "#bbbbbb",
    roughness: 0.4,
  });
  const names = [
    "沙发坐垫",
    "沙发靠枕",
    "窗帘",
    "羊毛地毯",
    "床单",
    "画作苔绿色块",
  ];
  for (const name of names) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), original);
    mesh.name = name;
    model.add(mesh);
  }
  isolateSoftSurfaces(model);
  assert.equal(new Set(model.children.map((m) => m.material)).size, 6);
  const references = model.children.map((m) => m.material);
  isolateSoftSurfaces(model);
  assert.deepEqual(
    model.children.map((m) => m.material),
    references,
  );
  const engine = Object.assign(Object.create(StudioScene.prototype), {
    originals: new Map(
      model.children.map(({ material }) => [
        material.uuid,
        {
          material,
          color: material.color.clone(),
          map: null,
          normalMap: null,
          normalScale: material.normalScale.clone(),
          roughness: material.roughness,
          metalness: 0,
        },
      ]),
    ),
    light() {},
    surfaceTexture(surface, channel) {
      return { surface, channel };
    },
  });
  engine.apply(materialSelection(initialStudio, "soft-boucle", "fabric"));
  const [sofa, pillow, curtain, rug, bedding, art] = model.children.map(
    (m) => m.material,
  );
  assert.equal(sofa.map.surface, "boucle");
  assert.equal(curtain.map.surface, "woven");
  assert.equal(rug.map.surface, "wool");
  assert.equal(bedding.map.surface, "woven");
  assert.notEqual(sofa.color.getHexString(), pillow.color.getHexString());
  assert.equal(rug.roughness, 1);
  assert.equal(art.color.getHexString(), "bbbbbb");
  assert.equal(art.map, null);
  engine.apply(initialStudio);
  for (const { material } of model.children) {
    assert.equal(material.color.getHexString(), "bbbbbb");
    assert.equal(material.roughness, 0.4);
    assert.equal(material.map, null);
  }
  assert.equal(original.color.getHexString(), "bbbbbb");
});
