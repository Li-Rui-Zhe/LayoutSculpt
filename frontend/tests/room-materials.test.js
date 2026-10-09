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
import { customMaterial, resolveMaterial } from "../src/materials/custom.js";
import { floorColor } from "../src/materials/assignments.js";

test("自定义颜色可持久化且按房间隔离，非法色号不进入草稿", () => {
  const custom = customMaterial(" A1B2C3 ");
  assert.equal(custom.id, "color:#a1b2c3");
  const state = JSON.parse(
    JSON.stringify(
      materialSelection(initialStudio, custom.id, "floor", "bedroom"),
    ),
  );
  assert.equal(selectedFloor(state, "bedroom"), custom.id);
  assert.equal(selectedFloor(state, "living"), null);
  const draft = applyFloorDraft(
    {
      layout: {
        rooms: [{ id: "bedroom" }, { id: "living", floor_material: "oak" }],
      },
    },
    state,
  );
  assert.equal(draft.layout.rooms[0].floor_material, custom.id);
  assert.equal(floorColor(draft.layout.rooms[0], "#000000"), "#a1b2c3");
  assert.equal(draft.layout.rooms[1].floor_material, "oak");
  for (const bad of [
    "color:#xyzxyz",
    "color:#12345678",
    "color:#123456\n",
    "color:red",
  ])
    assert.throws(() => materialSelection(initialStudio, bad, "walls"));
  assert.throws(() => customMaterial("red"));
  assert.equal(resolveMaterial("oak").id, "oak");
  assert.equal(resolveMaterial("missing"), undefined);
  for (const category of ["walls", "fabric"])
    assert.equal(
      materialSelection(initialStudio, custom.id, category).selected[category],
      custom.id,
    );
});

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
  engine.apply(
    materialSelection(
      initialStudio,
      customMaterial("#739ac4").id,
      "floor",
      "bedroom",
    ),
  );
  assert.equal(bedroom.material.color.getHexString(), "739ac4");
  assert.equal(living.material.color.getHexString(), "eeeeee");
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
