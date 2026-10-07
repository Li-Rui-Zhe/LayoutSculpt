import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { StudioScene } from "../src/viewer/StudioScene.js";
import { initialStudio } from "../src/hooks/useStudio.js";

function fixture() {
  const loads = [],
    loading = [],
    discarded = [],
    installed = [];
  const scene = Object.assign(Object.create(StudioScene.prototype), {
    revision: 0,
    disposed: false,
    active: true,
    cachedModels: new Map(),
    originals: new Map(),
    thumbnails: {},
    modelSize: new THREE.Vector3(),
    center: new THREE.Vector3(),
    scene: new THREE.Scene(),
    sun: new THREE.DirectionalLight(),
    camera: new THREE.OrthographicCamera(),
    controls: {
      target: new THREE.Vector3(),
      cursor: new THREE.Vector3(),
      update() {},
    },
    ground: new THREE.Object3D(),
    guide: new THREE.Object3D(),
    renderer: { domElement: { style: {}, dataset: {} } },
    composer: { render() {} },
    state: structuredClone(initialStudio),
    callbacks: {
      onLoading: (value) => loading.push(value),
      onView: () => installed.push(scene.modelUrl),
    },
    light() {},
    resize() {},
    async loadModel(url) {
      loads.push(url);
      return { scene: model(url) };
    },
  });
  function model(url) {
    const geometry = new THREE.BoxGeometry(4, 2, 3);
    geometry.addEventListener("dispose", () => discarded.push(url));
    const material = new THREE.MeshStandardMaterial({ color: "#eeeeee" });
    material.userData.surface_category = "walls";
    return new THREE.Mesh(geometry, material);
  }
  return { scene, loads, loading, discarded, installed, model };
}

test("缩略图结束前恢复选中光照，错误路径也不能残留其他光照", () => {
  let displayed, light;
  const engine = {
    state: { preset: "morning" },
    light(value) {
      light = value;
    },
    composer: {
      render() {
        displayed = light;
      },
    },
    thumbnail: () => displayed,
    callbacks: {
      onThumbnails(thumbs) {
        assert.equal(displayed, "morning");
        assert.equal(thumbs.night, "night");
      },
    },
  };
  StudioScene.prototype.refreshThumbnails.call(engine);
  assert.equal(displayed, "morning");
  engine.thumbnail = () => {
    throw new Error("capture failed");
  };
  assert.throws(
    () => StudioScene.prototype.refreshThumbnails.call(engine),
    /capture failed/,
  );
  assert.equal(displayed, "morning");
});

test("已查看的任务复用模型并恢复镜头，材质仍按任务独立应用", async () => {
  const { scene, loads, loading } = fixture();
  await scene.load("A");
  const a = scene.model;
  scene.apply({ ...initialStudio, selected: { walls: "sage" } });
  scene.camera.position.set(12, 18, 24);
  scene.camera.zoom = 1.5;
  scene.topView = true;
  await scene.load("B");
  scene.apply(initialStudio);
  assert.notEqual(scene.model, a);
  assert.equal(scene.model.material.color.getHexString(), "eeeeee");
  scene.apply({ ...initialStudio, selected: { walls: "sage" } });
  loading.length = 0;
  await scene.load("A");
  assert.equal(scene.model, a);
  assert.deepEqual(loads, ["A", "B"]);
  assert.deepEqual(loading, [false]);
  assert.equal(scene.model.material.color.getHexString(), "c7cec0");
  assert.equal(scene.camera.zoom, 1.5);
  assert.equal(scene.topView, true);
  assert.deepEqual(scene.camera.position.toArray(), [12, 18, 24]);
  assert.equal(scene.renderer.domElement.style.visibility, "visible");
});

test("加载示例时灯罩不遮挡自身光源，墙体仍可投射阴影", () => {
  const { scene, model } = fixture();
  const house = new THREE.Group();
  const wall = model("wall");
  house.add(wall);
  const shades = ["床头灯罩", "床头灯罩001", "落地灯灯罩"].map(
    (name, index) => {
      const shade = new THREE.Mesh(
        new THREE.SphereGeometry(0.1),
        new THREE.MeshStandardMaterial(),
      );
      shade.name = name;
      shade.position.set(index, 1.5, 0);
      house.add(shade);
      return shade;
    },
  );
  scene.installModel("/models/apartment.glb", { model: house });
  assert.equal(house.userData.designLights.length, 3);
  assert.ok(shades.every((shade) => !shade.castShadow && shade.visible));
  assert.equal(wall.castShadow, true);
});

test("快速切换时迟到模型被释放，不能覆盖当前任务", async () => {
  const { scene, installed, discarded, model } = fixture();
  let finishA;
  scene.loadModel = (url) =>
    url === "A"
      ? new Promise((resolve) => {
          finishA = () => resolve({ scene: model(url) });
        })
      : Promise.resolve({ scene: model(url) });
  const pending = scene.load("A");
  await scene.load("B");
  finishA();
  await pending;
  assert.deepEqual(installed, ["B"]);
  assert.deepEqual(discarded, ["A"]);
  assert.equal(scene.modelUrl, "B");
});

test("缓存有界，淘汰最久未使用的任务并释放几何资源", async () => {
  const { scene, discarded } = fixture();
  for (const url of ["A", "B", "A", "C", "D"]) await scene.load(url);
  assert.equal(scene.cachedModels.size, 2);
  assert.deepEqual(discarded, ["B"]);
  assert.deepEqual([...scene.cachedModels.keys()], ["A", "C"]);
});
