import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildTour } from "../src/viewer/tourModel.js";
import {
  buildWalkRegions,
  buildWalkObstacles,
  walkAreaError,
} from "../src/viewer/tourWalking.js";
import { RoomTour } from "../src/viewer/RoomTour.js";

function doorway() {
  const model = new THREE.Group();
  for (const [id, x] of [
    ["a", 0],
    ["b", 4.2],
  ]) {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.04, 4));
    floor.position.set(x, 0.02, 0);
    floor.userData = { structure_kind: "room", room_id: id };
    model.add(floor);
  }
  for (const [z, y, width, height] of [
    [-0.55, 1.1, 0.1, 2.2],
    [0.55, 1.1, 0.1, 2.2],
    [0, 2.15, 1.2, 0.1],
  ]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.2, height, width));
    frame.position.set(2.1, y, z);
    frame.name = "门套";
    frame.userData = {
      wall_id: "w",
      opening_index: 0,
      opening_kind: "door",
      wall_normal: [1, 0],
    };
    model.add(frame);
  }
  return model;
}
test("门洞连接两侧地板缝隙，点击路线可以双向通过，门旁边界不放开", () => {
  const model = doorway(),
    tour = buildTour(model);
  const a = tour.rooms[0],
    b = tour.rooms[1];
  const obstacles = buildWalkObstacles(model, a.floor);
  const regions = buildWalkRegions(tour.rooms, tour.portals, a);
  assert.equal(
    walkAreaError({ x: 1, y: 0 }, { x: 3, y: 0 }, regions, obstacles),
    "",
  );
  assert.equal(
    walkAreaError(
      { x: 3, y: 0 },
      { x: 1, y: 0 },
      buildWalkRegions(tour.rooms, tour.portals, b),
      obstacles,
    ),
    "",
  );
  assert.ok(
    walkAreaError({ x: 1, y: 1.2 }, { x: 3, y: 1.2 }, regions, obstacles),
  );
  assert.ok(
    walkAreaError(
      { x: 1, y: 0 },
      { x: 3, y: 0 },
      buildWalkRegions(tour.rooms, [], a),
      obstacles,
    ),
  );
  assert.ok(
    walkAreaError(
      { x: 1, y: 0 },
      { x: 3, y: 0 },
      buildWalkRegions([a, { ...b, floor: 0.4 }], tour.portals, a),
      obstacles,
    ),
  );
});
test("键盘按住可连续越过门槛并更新当前房间，不依赖热点跳转", () => {
  const model = doorway(),
    data = buildTour(model);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(1.7, 1.59, 0);
  const tour = new RoomTour({ model, camera, callbacks: {} });
  tour.active = true;
  tour.room = data.rooms[0];
  tour.data = data;
  tour.walkCollision = new Map();
  tour.yaw = Math.PI / 2;
  tour.pitch = 0;
  tour.hotspots = [];
  tour.renderHotspots = () => {};
  tour.setMoveInput("key:KeyW", "forward", true);
  for (let i = 0; i < 15; i++) tour.update(tour.manualTime + 50);
  assert.equal(tour.room.id, "b");
  assert.ok(camera.position.x > 2.7);
  tour.clearMoveInputs();
});
test("地板接通后，关着的门板和玻璃仍受真实几何阻挡", () => {
  const model = doorway();
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 2, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.1 }),
  );
  panel.position.set(2.1, 1, 0);
  panel.name = "门扇";
  panel.userData = {
    wall_id: "w",
    opening_index: 0,
    opening_kind: "door",
    wall_normal: [1, 0],
  };
  model.add(panel);
  const tour = buildTour(model),
    a = tour.rooms[0];
  assert.ok(
    walkAreaError(
      { x: 1, y: 0 },
      { x: 3, y: 0 },
      buildWalkRegions(tour.rooms, tour.portals, a),
      buildWalkObstacles(model, a.floor),
    ),
  );
});
test("真实示例的露台整段开口可连续进入客厅，露台外侧仍不能越界", async () => {
  const bytes = await readFile(
    new URL("../../public/models/forest-home-v3.glb", import.meta.url),
  );
  const loader = new GLTFLoader();
  // 测试只读模型几何和元数据，不依赖 DOM 图片解码。
  loader.register(() => ({
    name: "geometry-only",
    loadTexture: () => Promise.resolve(null),
  }));
  const { scene } = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  const tour = buildTour(scene),
    terrace = tour.rooms.find((r) => r.id === "terrace");
  const regions = buildWalkRegions(tour.rooms, tour.portals, terrace);
  const obstacles = buildWalkObstacles(scene, terrace.floor);
  assert.ok(
    tour.portals.find((p) => p.rooms.includes("terrace")).bridges.length > 1,
  );
  for (const x of [-3.7, -2.5, -1.7, -0.5]) {
    assert.equal(
      walkAreaError({ x, y: 3.3 }, { x, y: 1.5 }, regions, obstacles),
      "",
    );
    assert.equal(
      walkAreaError({ x, y: 1.5 }, { x, y: 3.3 }, regions, obstacles),
      "",
    );
  }
  assert.ok(
    walkAreaError({ x: -1.7, y: 3.3 }, { x: -1.7, y: 5.5 }, regions, obstacles),
  );
});
