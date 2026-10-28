import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { bindLiveLights, syncLiveLights } from "../src/editor/liveLights.js";
import { installFixtureLights } from "../src/viewer/fixtureLights.js";
import { liveCapabilities, liveSceneSnapshot, canSyncLiveScene } from "../src/editor/liveSceneUpdates.js";
import { updateLiveArchitecture } from "../src/editor/liveArchitecture.js";
import { pendingSceneObjects } from "../src/editor/scenePending.js";
import { applySceneEdit, scenePose } from "../src/editor/sceneEdits.js";

test("AI 高度浮点尾差不会让平移误触发重建，已有旧草稿也能复用", () => {
  const base = { layout: { outline: [], rooms: [], walls: [], openings: [], lights: [
    { id: "auto_1", x: 2.701, y: 2.341, kind: "pendant", elevation: 2.4499999999999997 },
  ] }, furniture: { items: [] } };
  const selection = { type: "lights", index: 0 };
  const capabilities = { lightPoseIds: ["auto_1"] };
  const pose = scenePose(base, selection);
  const next = applySceneEdit(base, selection, { ...pose, x: 1.749, scale: { x: 1, y: 1, z: 1 } });
  assert.equal(next.layout.lights[0].elevation, base.layout.lights[0].elevation);
  // 兼容旧拖动逻辑已保存的 2.45，不要求用户重新生成或清空草稿。
  next.layout.lights[0].elevation = 2.45;
  assert.equal(canSyncLiveScene(base, next, capabilities), true);
  assert.deepEqual(pendingSceneObjects(liveSceneSnapshot(base, next, capabilities), next), []);
  next.layout.lights[0].elevation = 2.451;
  assert.equal(canSyncLiveScene(base, next, capabilities), false);
  assert.equal(pendingSceneObjects(liveSceneSnapshot(base, next, capabilities), next).length, 1);
});

test("灯具连续平移保留真实几何、光源和目标点，撤销无漂移且不触发建筑重建或加载提示", () => {
  const source = { id: "lamp", kind: "pendant", x: 2, y: 3, elevation: 2, lumens: 500, temperature: 3000, enabled: true };
  const doc = { layout: { outline: [], walls: [], rooms: [], openings: [], lights: [source] }, furniture: { items: [] } };
  const model = new THREE.Group();
  model.position.set(3, 0, -2);
  const material = new THREE.MeshStandardMaterial();
  const shade = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  shade.userData = { fixture_owner_id: "lamp" };
  const emitter = shade.clone();
  emitter.userData = { fixture_owner_id: "lamp", fixture_id: "lamp", fixture_kind: "pendant", fixture_lumens: 500, fixture_visual_placeholder: false };
  const proxy = shade.clone();
  proxy.userData = { fixture_id: "lamp", editor_proxy: true };
  model.add(shade, emitter);
  installFixtureLights(model);
  model.add(proxy);
  const fixture = model.userData.designLights[0];
  const nodes = [shade, emitter, proxy, fixture.light, fixture.light.target];
  const positions = nodes.map((node) => node.getWorldPosition(new THREE.Vector3()));
  const groups = bindLiveLights(model, doc);
  assert.equal(groups.size, 1);
  const group = new THREE.Group(); group.add(model);
  const rt = { group, modelDocument: doc, liveLights: groups };
  const capabilities = liveCapabilities(rt);
  for (let i = 0; i < 60; i++) {
    const next = structuredClone(doc);
    Object.assign(next.layout.lights[0], { x: 2 + i / 10, y: 3 - i / 20 });
    syncLiveLights(groups, next);
    for (const [index, node] of nodes.entries()) {
      const expected = positions[index].clone().add(new THREE.Vector3(i / 10, 0, -i / 20));
      assert.ok(node.getWorldPosition(new THREE.Vector3()).distanceTo(expected) < 1e-8);
    }
    assert.equal(canSyncLiveScene(doc, next, capabilities), true);
    assert.deepEqual(pendingSceneObjects(liveSceneSnapshot(doc, next, capabilities), next), []);
    updateLiveArchitecture(rt, next, true, false);
    assert.equal(rt.architectureOverlay, undefined);
  }
  syncLiveLights(groups, doc);
  nodes.forEach((node, i) => assert.ok(node.getWorldPosition(new THREE.Vector3()).distanceTo(positions[i]) < 1e-8));
  for (const patch of [{ elevation: 3 }, { kind: "floor_lamp" }]) {
    const next = structuredClone(doc); Object.assign(next.layout.lights[0], patch);
    assert.equal(canSyncLiveScene(doc, next, capabilities), false);
  }
});

test("没有完整部件归属的旧灯具不能仅移动灯泡", () => {
  const model = new THREE.Group();
  const marker = new THREE.Object3D(); marker.userData.fixture_id = "old";
  model.add(marker);
  assert.equal(bindLiveLights(model, { layout: { lights: [{ id: "old" }] } }).size, 0);
});
