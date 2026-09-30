import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  installFixtureLights,
  updateFixtureLights,
} from "../src/viewer/fixtureLights.js";
import { presets } from "../src/catalog.js";

test("白天和夜晚两种光照，灯具位置、强度、开关独立且安装幂等", () => {
  assert.deepEqual(
    presets.map((p) => p.name),
    ["白天", "夜晚"],
  );
  const model = new THREE.Group();
  model.position.set(3, 0, 2);
  for (let i = 0; i < 2; i++) {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.1),
      new THREE.MeshStandardMaterial({ emissive: "#ffd091" }),
    );
    bulb.position.set(i, 2, 1);
    bulb.userData = {
      fixture_id: `l${i}`,
      fixture_lumens: 800,
      fixture_temperature: 3000,
      fixture_enabled: i === 0,
    };
    model.add(bulb);
  }
  installFixtureLights(model);
  installFixtureLights(model);
  assert.equal(model.userData.designLights.length, 2);
  const [a, b] = model.userData.designLights;
  assert.deepEqual(a.light.position.toArray(), [0, 2, 1]);
  updateFixtureLights(model, true);
  assert.ok(a.light.intensity > 60);
  assert.equal(b.light.visible, false);
  assert.equal(a.materials[0].emissiveIntensity, 2);
  updateFixtureLights(model, false);
  assert.equal(a.light.intensity, 0);
  assert.equal(a.materials[0].emissiveIntensity, 0);
  const other = new THREE.Group();
  installFixtureLights(other);
  updateFixtureLights(other, true);
  assert.equal(other.userData.designLights.length, 0);
});
