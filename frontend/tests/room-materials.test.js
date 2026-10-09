import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { initialStudio } from "../src/hooks/useStudio.js";
import {
  materialSelection,
  selectedFloor,
  applyFloorDraft,
} from "../src/materials/assignments.js";
import { isolateRoomFloors } from "../src/viewer/roomMaterials.js";
import { StudioScene } from "../src/viewer/StudioScene.js";

test("单房间、全屋替换和还原不会混淆，旧存储兼容且不修改历史状态", () => {
  const base = structuredClone(initialStudio);
  const all = materialSelection(base, "oak", "floor");
  const bedroom = materialSelection(all, "gray", "floor", "bedroom");
  assert.equal(selectedFloor(bedroom, "living"), "oak");
  assert.equal(selectedFloor(bedroom, "bedroom"), "gray");
  assert.deepEqual(base.roomFloors, {});
  const restored = materialSelection(bedroom, null, "floor", "bedroom");
  assert.equal(selectedFloor(restored, "bedroom"), null);
  assert.equal(selectedFloor(restored, "living"), "oak");
  assert.deepEqual(
    materialSelection(restored, "sand", "floor", "all").roomFloors,
    {},
  );
  assert.equal(
    selectedFloor({ selected: { floor: "walnut" } }, "living"),
    "walnut",
  );
  assert.throws(() => materialSelection(base, "teal", "floor"));
});

test("共享 GLTF 材质按房间隔离，应用与还原真实材质不串色且不重复克隆", () => {
  const model = new THREE.Group();
  const shared = new THREE.MeshStandardMaterial({ color: "#eeeeee" });
  for (const id of ["living", "bedroom"]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.02, 2), shared);
    mesh.name = id;
    mesh.userData = { structure_kind: "room", room_id: id, room_name: id };
    model.add(mesh);
  }
  const rooms = isolateRoomFloors(model);
  assert.equal(rooms.length, 2);
  const [living, bedroom] = model.children;
  assert.notEqual(living.material, bedroom.material);
  const engine = Object.assign(Object.create(StudioScene.prototype), {
    originals: new Map(
      model.children.map((obj) => [
        obj.material.uuid,
        {
          material: obj.material,
          color: obj.material.color.clone(),
          map: null,
          normalMap: null,
          normalScale: obj.material.normalScale.clone(),
          roughness: obj.material.roughness,
          metalness: 0,
        },
      ]),
    ),
    light() {},
    surfaceTexture() {
      return null;
    },
  });
  engine.apply(
    materialSelection(initialStudio, "charcoal", "floor", "bedroom"),
  );
  assert.equal(living.material.color.getHexString(), "eeeeee");
  assert.equal(bedroom.material.color.getHexString(), "303d46");
  const previous = bedroom.material;
  assert.equal(isolateRoomFloors(model), rooms);
  assert.equal(bedroom.material, previous);
  engine.apply(initialStudio);
  assert.equal(bedroom.material.color.getHexString(), "eeeeee");
});

test("预览地板写入人工草稿时保留其他编辑、停用地板和原始文档", () => {
  const document = {
    layout: {
      rooms: [
        { id: "living", floor_finish: "oak", name: "编辑后的客厅" },
        { id: "bedroom", floor_material: "gray" },
        { id: "off", floor_enabled: false },
      ],
    },
    furniture: { items: [{ name: "用户家具" }] },
  };
  const state = materialSelection(
    materialSelection(initialStudio, "honey", "floor"),
    null,
    "floor",
    "bedroom",
  );
  const result = applyFloorDraft(document, state, [
    { id: "bedroom", floor_finish: "walnut" },
  ]);
  assert.equal(result.layout.rooms[0].floor_material, "honey");
  assert.equal(result.layout.rooms[0].name, "编辑后的客厅");
  assert.equal(result.layout.rooms[1].floor_material, null);
  assert.equal(result.layout.rooms[1].floor_finish, "walnut");
  assert.equal(result.layout.rooms[2].floor_material, undefined);
  assert.equal(document.layout.rooms[0].floor_material, undefined);
  assert.deepEqual(result.furniture, document.furniture);
});
