import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomViews, recommendedRooms } from "../src/viewer/RoomViews.js";
import { RoomTour } from "../src/viewer/RoomTour.js";
import { buildTour } from "../src/viewer/tourModel.js";
import {
  buildWalkObstacles,
  walkPathError,
} from "../src/viewer/tourWalking.js";

const room = {
  id: "living",
  name: "客厅",
  floor: 0,
  polygon: [
    { x: -3, y: -3 },
    { x: 3, y: -3 },
    { x: 3, y: 3 },
    { x: -3, y: 3 },
  ],
  stations: [
    { x: 0, y: 0, height: 1.55 },
    { x: 2, y: 1, height: 1.55 },
  ],
};
function box(model, x, z, width = 1, depth = 1) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 2.5, depth));
  mesh.position.set(x, 1.25, z);
  model.add(mesh);
  return mesh;
}
test("推荐排除无站位与室外，客餐卧优先且最多四间", () => {
  const rooms = ["卫生间", "阳台", "书房", "主卧", "客厅", "餐厅", "次卧"].map(
    (name, i) => ({ ...room, id: String(i), name }),
  );
  assert.deepEqual(
    recommendedRooms(rooms).map((r) => r.name),
    ["客厅", "餐厅", "主卧", "次卧"],
  );
  assert.deepEqual(recommendedRooms([{ ...room, stations: [] }]), []);
});
test("推荐不进入遮挡物内部，避开近墙；相同房间复用结果", () => {
  const model = new THREE.Group();
  box(model, 0, 0); // 第一站在柜内。
  box(model, 2, 0.35, 2, 0.2); // 第二站正前方为近墙。
  const views = new RoomViews(
    model,
    { rooms: [room], portals: [] },
    () => true,
  );
  const result = views.get(room);
  assert.ok(result);
  assert.equal(result.station, room.stations[1]);
  assert.ok(Math.cos(result.yaw) < 0.9, "不能正对近墙");
  assert.equal(views.get(room), result);
  assert.equal(model.children.length, 2);
});
test("站位检查全部失败时不捏造推荐位置", () => {
  const views = new RoomViews(
    new THREE.Group(),
    { rooms: [room], portals: [] },
    () => false,
  );
  assert.equal(views.get(room), null);
});

test("同房间再次点击推荐恢复构图，保留返回鸟瞰镜头且不加载模型", () => {
  const model = new THREE.Group();
  const scene = { model, camera: new THREE.PerspectiveCamera(), callbacks: {} };
  const tour = new RoomTour(scene);
  tour.active = true;
  tour.data = { rooms: [room], available: [room], portals: [] };
  tour.roomViews = new RoomViews(model, tour.data, () => true);
  tour.renderHotspots = () => {};
  tour.saved = { position: [12, 18, 20], target: [0, 0, 0], zoom: 1 };
  const saved = structuredClone(tour.saved);
  assert.equal(tour.move(room.id, null, false, true), true);
  const position = scene.camera.position.clone(),
    yaw = tour.yaw;
  tour.turn(1.5, 0.5);
  scene.camera.position.x += 0.3;
  scene.camera.fov = 85;
  assert.equal(tour.move(room.id, null, false, true), true);
  assert.ok(scene.camera.position.equals(position));
  assert.equal(tour.yaw, yaw);
  assert.equal(scene.camera.fov, 62);
  assert.deepEqual(tour.saved, saved);
});
test("真实示例的主要房间具有安全推荐视角，模型几何不变", async () => {
  const bytes = await readFile(
    new URL("../../public/models/forest-home-v3.glb", import.meta.url),
  );
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: "geometry-only",
    loadTexture: () => Promise.resolve(null),
  }));
  const { scene } = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  const data = buildTour(scene),
    collision = new Map();
  const views = new RoomViews(scene, data, (r, p) => {
    if (!collision.has(r.id))
      collision.set(r.id, buildWalkObstacles(scene, r.floor));
    return !walkPathError(p, p, r.polygon, collision.get(r.id));
  });
  const rooms = recommendedRooms(data.available);
  assert.ok(rooms.length >= 3);
  for (const item of rooms) {
    const r = data.rooms.find((r) => r.id === item.id),
      view = views.get(r);
    assert.ok(view, `${r.name} 应找到推荐角度`);
    assert.equal(
      walkPathError(view.station, view.station, r.polygon, collision.get(r.id)),
      "",
    );
    assert.ok(Number.isFinite(view.yaw));
  }
});
