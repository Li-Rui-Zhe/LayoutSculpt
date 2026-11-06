import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { installCutaway, updateCutaway, setCutawaySelection } from "../src/viewer/cutaway.js";

test("剖切选中空调时只临时显示该件，取消选择恢复隐藏且不改保存数据", () => {
  const model = new THREE.Group();
  const groups = ["空调一", "空调二"].map((name, index) => {
    const group = new THREE.Group();
    // A source index can differ from the current list index after deleting items.
    for (let part = 0; part < 2; part++) {
      const mesh = new THREE.Object3D();
      mesh.userData = {furniture_index: index + 3, furniture_kind: "aircon_wall", furniture_name: name};
      group.add(mesh);
    }
    model.add(group);
    return group;
  });
  const savedData = JSON.stringify(groups.map(g => g.children.map(m => m.userData)));
  const replacedWall = new THREE.Object3D();
  replacedWall.userData = { cutaway_only: true };
  replacedWall.visible = false; // Live architecture has replaced this saved wall.
  model.add(replacedWall);
  setCutawaySelection(model, groups[0]);
  updateCutaway(model, null, {furnitureOnly: true});
  assert.equal(replacedWall.visible, false);
  assert.ok(groups[0].children.every(m => m.visible));
  assert.ok(groups[1].children.every(m => !m.visible));
  setCutawaySelection(model, groups[1]);
  updateCutaway(model, null);
  assert.ok(groups[0].children.every(m => !m.visible));
  assert.ok(groups[1].children.every(m => m.visible));
  groups[1].visible = false; // Explicitly hidden furniture must stay hidden.
  updateCutaway(model, null);
  assert.ok(groups[1].children.every(m => !m.visible));
  setCutawaySelection(model, null);
  updateCutaway(model, null);
  assert.ok(groups.every(g => g.children.every(m => !m.visible)));
  updateCutaway(model, null, {enabled: false});
  assert.ok(groups.every(g => g.children.every(m => m.visible)));
  assert.equal(groups[1].visible, false);
  assert.equal(JSON.stringify(groups.map(g => g.children.map(m => m.userData))), savedData);
});

test("剖切只隐藏壁挂空调，电视、吊柜与落地空调保留，完整墙体恢复", () => {
  const model = new THREE.Group();
  const parts = [
    { furniture_index: 0, placement_surface: "wall", furniture_kind: "aircon_wall" },
    { furniture_index: 1, placement_surface: "wall", furniture_kind: "wall_television" },
    { furniture_index: 2, furniture_name: "卧室壁挂空调" },
    { furniture_index: 3, placement_surface: "floor", furniture_name: "立式空调" },
    { furniture_index: 4, furniture_kind: "sofa" },
    { furniture_index: 5, placement_surface: "wall", furniture_kind: "kitchen_wall_cabinet" },
    { furniture_index: 6, furniture_name: "超薄壁挂电视" },
    { furniture_index: 7, furniture_kind: "aircon_tower" },
    { furniture_index: 8, placement_surface: "wall", furniture_name: "卧室空调" },
    { furniture_index: 9, furniture_name: "浴室镜柜" },
  ].map((userData) => { const mesh = new THREE.Object3D(); mesh.userData = userData; model.add(mesh); return mesh; });
  updateCutaway(model, null);
  assert.deepEqual(parts.map(p => p.visible), [false, true, false, true, true, true, true, true, false, true]);
  updateCutaway(model, null, {enabled: false});
  assert.ok(parts.every(p => p.visible));
  updateCutaway(model, null);
  assert.deepEqual(parts.map(p => p.visible), [false, true, false, true, true, true, true, true, false, true]);
});

test("完整墙体与封口剖切预览互斥显示，重复安装不会增加几何", () => {
  const model = new THREE.Group();
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(2, 3, 0.2),
    new THREE.MeshStandardMaterial(),
  );
  const preview = new THREE.BoxGeometry(2, 1.2, 0.2);
  wall.userData = {
    cutaway_full: true,
    cutaway_geometry: {
      positions: Array.from(preview.attributes.position.array),
      indices: Array.from(preview.index.array),
    },
  };
  model.add(wall);
  installCutaway(model);
  installCutaway(model);
  assert.equal(model.children.length, 2);
  const cut = model.children[1];
  updateCutaway(model, new THREE.PerspectiveCamera());
  assert.equal(wall.visible, false);
  assert.equal(cut.visible, true);
  updateCutaway(model, new THREE.PerspectiveCamera(), { enabled: false });
  assert.equal(wall.visible, true);
  assert.equal(cut.visible, false);
  assert.equal(cut.material, wall.material);
});

test("水平剖切随旋转保持连续，完整模式恢复所有墙体，低墙不会消失", () => {
  const model = new THREE.Group(),
    camera = new THREE.PerspectiveCamera();
  const parts = [
    { cutaway_upper: false },
    { cutaway_upper: true, wall_exterior: true, wall_normal: [0, 1] },
    { cutaway_upper: true, wall_exterior: true, wall_normal: [0, -1] },
    { cutaway_upper: true, wall_exterior: false },
  ].map((data) => {
    const obj = new THREE.Object3D();
    obj.userData = data;
    model.add(obj);
    return obj;
  });
  camera.position.set(0, 8, 10);
  updateCutaway(model, camera);
  assert.deepEqual(
    parts.map((o) => o.visible),
    [true, false, false, false],
  );
  camera.position.z = -10;
  updateCutaway(model, camera);
  assert.deepEqual(
    parts.map((o) => o.visible),
    [true, false, false, false],
  );
  updateCutaway(model, camera, { top: true });
  assert.deepEqual(
    parts.map((o) => o.visible),
    [true, false, false, false],
  );
  updateCutaway(model, camera, { enabled: false });
  assert.ok(parts.every((o) => o.visible));
});
