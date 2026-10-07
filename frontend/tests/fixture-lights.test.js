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
  assert.ok(a.light.intensity > 0);
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

test("示例模型的灯罩在夜晚点亮，且不改变共享材质或普通模型", () => {
  const model = new THREE.Group();
  const shared = new THREE.MeshStandardMaterial({ color: "#eee8dc" });
  for (const name of ["床头灯罩", "床头灯罩.001", "落地灯灯罩"]) {
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.1), shared);
    // GLTFLoader sanitizes punctuation, including Blender's .001 suffix.
    shade.name = THREE.PropertyBinding.sanitizeNodeName(name);
    shade.position.set(1, 1.5, 2);
    model.add(shade);
  }
  installFixtureLights(model, { sample: true });
  assert.equal(model.userData.designLights.length, 3);
  assert.equal(shared.emissiveIntensity, 1);
  assert.notEqual(model.children[0].material, shared);
  updateFixtureLights(model, true);
  assert.ok(model.userData.designLights.every(({ light }) => light.visible));
  assert.ok(
    model.userData.designLights.every(
      ({ materials }) => materials[0].emissiveIntensity === 2,
    ),
  );
  updateFixtureLights(model, false);
  assert.ok(model.userData.designLights.every(({ light }) => !light.visible));

  const ordinary = new THREE.Group();
  ordinary.add(new THREE.Mesh(new THREE.SphereGeometry(0.1), shared));
  ordinary.children[0].name = "床头灯罩";
  installFixtureLights(ordinary);
  assert.equal(ordinary.userData.designLights.length, 0);
});

test("隐藏新旧裸灯泡及吊线，保留实际灯具与独立光源", () => {
  const model = new THREE.Group();
  const mesh = (name, data, x = 0) => {
    const item = new THREE.Mesh(
      new THREE.SphereGeometry(0.1),
      new THREE.MeshStandardMaterial(),
    );
    item.name = name;
    item.userData = data;
    item.position.set(x, 2.4, 0);
    model.add(item);
    return item;
  };
  const source = (id, kind, extra = {}) => ({
    fixture_id: id,
    fixture_kind: kind,
    fixture_lumens: 900,
    fixture_temperature: 3000,
    fixture_enabled: true,
    ...extra,
  });
  const legacy = mesh("灯泡_old_1", source("old", "pendant"));
  const wire = mesh("吊灯吊线_2", {});
  const holder = mesh("吊灯灯座_3", {});
  const bulb = mesh(
    "自定义标记",
    source("new", "bulb", { fixture_visual_placeholder: true }),
    1,
  );
  const base = mesh("自定义底座", {
    fixture_visual_placeholder: true,
    fixture_visual_id: "new",
  });
  const floorLamp = mesh("灯泡_floor_4", source("floor", "floor_lamp"), 2);
  const realPendant = mesh(
    "灯泡_designed_5",
    source("designed", "pendant", { fixture_visual_placeholder: false }),
    3,
  );
  const before = structuredClone(bulb.userData);
  installFixtureLights(model);
  for (const item of [legacy, wire, holder, bulb, base])
    assert.equal(item.visible, false);
  assert.equal(model.userData.hiddenFixtureVisualCount, 5);
  assert.equal(floorLamp.visible, true);
  assert.equal(realPendant.visible, true);
  assert.deepEqual(bulb.userData, before);
  updateFixtureLights(model, true);
  assert.equal(model.userData.designLights.length, 4);
  for (const { light } of model.userData.designLights) {
    assert.equal(light.parent, model);
    assert.equal(light.visible, true);
    assert.ok(light.intensity > 0);
  }
  assert.deepEqual(
    model.userData.designLights[1].light.position.toArray(),
    [1, 2.4, 0],
  );
  updateFixtureLights(model, false);
  assert.ok(
    model.userData.designLights.every(
      ({ light }) => !light.visible && light.intensity === 0,
    ),
  );
  assert.equal(bulb.visible, false);
});

test("柔化照明后亮度仍随流明线性变化，色温与关闭状态独立保留", () => {
  const model = new THREE.Group();
  for (const [i, lumens, temperature, enabled] of [
    [0, 600, 2700, true],
    [1, 1200, 6500, true],
    [2, 1200, 3000, false],
  ]) {
    const marker = new THREE.Object3D();
    marker.userData = {
      fixture_id: String(i),
      fixture_lumens: lumens,
      fixture_temperature: temperature,
      fixture_enabled: enabled,
    };
    model.add(marker);
  }
  installFixtureLights(model);
  updateFixtureLights(model, true);
  const [warm, cool, off] = model.userData.designLights;
  assert.equal(cool.light.intensity / warm.light.intensity, 2);
  assert.ok(warm.light.color.r > warm.light.color.b);
  assert.ok(cool.light.color.b > cool.light.color.r);
  assert.equal(off.light.intensity, 0);
  assert.equal(off.light.visible, false);
  updateFixtureLights(model, false);
  assert.ok(
    model.userData.designLights.every(({ light }) => light.intensity === 0),
  );
});
