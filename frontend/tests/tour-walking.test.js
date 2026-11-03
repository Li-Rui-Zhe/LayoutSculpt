import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  walkPathError,
  buildWalkObstacles,
  dragExceeded,
  walkingPosition,
  buildWalkRegions,
  walkAreaError,
} from "../src/viewer/tourWalking.js";
import { RoomTour } from "../src/viewer/RoomTour.js";
import { createWalkRouter, routePosition } from "../src/viewer/tourRouting.js";

const room = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 8 },
  { x: 0, y: 8 },
];
test("建筑构件仍需绕行，每一段均满足连续碰撞检查", () => {
  const model = new THREE.Group();
  const furniture = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 3));
  furniture.position.set(4, 0.5, 4);
  furniture.userData.asset_id = "architecture-column";
  model.add(furniture);
  const obstacles = buildWalkObstacles(model, 0),
    regions = [[room]];
  const from = { x: 1, y: 4 },
    to = { x: 7, y: 4 };
  const route = createWalkRouter(regions, obstacles)(from, to);
  assert.equal(route.error, undefined);
  assert.ok(route.points.length > 2);
  assert.deepEqual(route.points[0], from);
  assert.deepEqual(route.points.at(-1), to);
  for (let i = 1; i < route.points.length; i++)
    assert.equal(
      walkAreaError(route.points[i - 1], route.points[i], regions, obstacles),
      "",
    );
  const points = route.points.map((p) => new THREE.Vector3(p.x, 1.55, p.y));
  let previous = points[0];
  for (let t = 0; t <= 100; t++) {
    const p = routePosition(points, t / 100);
    assert.equal(
      walkAreaError(
        { x: previous.x, y: previous.z },
        { x: p.x, y: p.z },
        regions,
        obstacles,
      ),
      "",
    );
    previous = p;
  }
  assert.deepEqual(routePosition(points, 1).toArray(), points.at(-1).toArray());
  assert.ok(createWalkRouter(regions, obstacles)(from, { x: 4, y: 4 }).error);
});
test("绕行不穿封闭墙体、独立地面或中庭，窄于人体的缝隙不能通行", () => {
  const model = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.01, 2.5, 7.7));
  wall.position.set(4, 1.25, 4);
  wall.userData.wall_id = "wall";
  model.add(wall);
  assert.ok(
    createWalkRouter([[room]], buildWalkObstacles(model, 0))(
      { x: 1, y: 4 },
      { x: 7, y: 4 },
    ).error,
  );
  const hole = [
    { x: 3, y: 3 },
    { x: 5, y: 3 },
    { x: 5, y: 5 },
    { x: 3, y: 5 },
  ];
  const regions = [[room, hole]];
  const route = createWalkRouter(regions, [])({ x: 1, y: 4 }, { x: 7, y: 4 });
  assert.ok(route.points.length > 2);
  for (let i = 1; i < route.points.length; i++)
    assert.equal(
      walkAreaError(route.points[i - 1], route.points[i], regions, []),
      "",
    );
  assert.ok(
    createWalkRouter(regions, [])({ x: 1, y: 4 }, { x: 4, y: 4 }).error,
  );
  assert.ok(
    createWalkRouter([[room], [room.map((p) => ({ ...p, x: p.x + 10 }))]], [])(
      { x: 1, y: 4 },
      { x: 11, y: 4 },
    ).error,
  );
});
test("实际射线点击反向法线的双面地板也能识别落点，墙面不被误选", () => {
  const camera = new THREE.PerspectiveCamera(68, 1, 0.035, 100);
  camera.position.set(2, 1.55, 2);
  camera.lookAt(4, 0, 4);
  camera.updateMatrixWorld();
  const model = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  floor.rotation.x = Math.PI / 2;
  floor.position.set(4, 0, 4);
  model.add(floor);
  model.updateMatrixWorld(true);
  const tour = new RoomTour({ camera, model });
  tour.canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 500 }),
  };
  tour.ray = new THREE.Raycaster();
  tour.data = { rooms: [{ id: "r", floor: 0, polygon: room }] };
  let destination, message;
  tour.walkTo = (p) => {
    destination = p;
  };
  tour.publish = (m) => {
    message = m;
  };
  tour.clickGround(250, 250);
  assert.ok(Math.abs(destination.x - 4) < 1e-6);
  assert.ok(Math.abs(destination.y - 4) < 1e-6);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 0.1));
  wall.position.set(4, 1.5, 3);
  model.add(wall);
  model.updateMatrixWorld(true);
  destination = null;
  tour.clickGround(250, 250);
  assert.equal(destination, null);
  assert.match(message, /空地/);
});
test("开放区域跨功能分区移动，未连接房间和门槛不自动跨越", () => {
  const a = {
    id: "a",
    floor: 0,
    polygon: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ],
  };
  const b = {
    id: "b",
    floor: 0,
    polygon: [
      { x: 4, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 4 },
      { x: 4, y: 4 },
    ],
  };
  const links = [{ rooms: ["a", "b"] }],
    from = { x: 2, y: 2 },
    to = { x: 6, y: 2 };
  assert.equal(
    walkAreaError(from, to, buildWalkRegions([a, b], links, a), []),
    "",
  );
  assert.ok(walkAreaError(from, to, buildWalkRegions([a, b], [], a), []));
  assert.ok(
    walkAreaError(
      from,
      to,
      buildWalkRegions([a, { ...b, floor: 0.3 }], links, a),
      [],
    ),
  );
  const gap = { ...b, polygon: b.polygon.map((p) => ({ ...p, x: p.x + 0.2 })) };
  assert.ok(walkAreaError(from, to, buildWalkRegions([a, gap], links, a), []));
});
test("合并区域保留内洞，不能走过中庭或缺失地板", () => {
  const hole = [
    { x: 3, y: 3 },
    { x: 5, y: 3 },
    { x: 5, y: 5 },
    { x: 3, y: 5 },
  ];
  assert.ok(walkAreaError({ x: 1, y: 4 }, { x: 7, y: 4 }, [[room, hole]], []));
  assert.ok(walkAreaError({ x: 1, y: 4 }, { x: 4, y: 4 }, [[room, hole]], []));
  assert.equal(
    walkAreaError({ x: 1, y: 1 }, { x: 7, y: 1 }, [[room, hole]], []),
    "",
  );
});
test("落点可站但中途经过建筑障碍时拒绝；空旷路线允许", () => {
  const obstacles = [
    {
      minX: 3,
      maxX: 4,
      minY: 2,
      maxY: 5,
      polygon: [
        { x: 3, y: 2 },
        { x: 4, y: 2 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ],
    },
  ];
  assert.ok(walkPathError({ x: 1, y: 3 }, { x: 6, y: 3 }, room, obstacles));
  assert.equal(
    walkPathError({ x: 1, y: 1 }, { x: 6, y: 1 }, room, obstacles),
    "",
  );
  assert.ok(walkPathError({ x: 1, y: 1 }, { x: 3.5, y: 3 }, room, obstacles));
});
test("凹形房间禁止斜穿墙角，边界和外部落点不可通过", () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 6 },
    { x: 0, y: 6 },
  ];
  assert.ok(walkPathError({ x: 1, y: 5 }, { x: 5, y: 1 }, polygon, []));
  assert.equal(walkPathError({ x: 1, y: 5 }, { x: 1, y: 1 }, polygon, []), "");
  assert.ok(walkPathError({ x: 1, y: 1 }, { x: 0.1, y: 4 }, polygon, []));
  assert.ok(walkPathError({ x: 1, y: 1 }, { x: 9, y: 1 }, polygon, []));
  assert.ok(walkPathError({ x: 1, y: 1 }, { x: NaN, y: 1 }, polygon, []));
});
test("实际三角形的连续碰撞检测拦住薄墙和玻璃，不受网格采样间隔影响", () => {
  const model = new THREE.Group();
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(0.005, 2.5, 3),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.1 }),
  );
  wall.position.set(3.12345, 1.25, 3);
  wall.userData.architecture_network = true;
  model.add(wall);
  const obstacles = buildWalkObstacles(model, 0);
  assert.ok(walkPathError({ x: 1, y: 3 }, { x: 6, y: 3 }, room, obstacles));
  assert.equal(
    walkPathError({ x: 1, y: 1 }, { x: 6, y: 1 }, room, obstacles),
    "",
  );
  // 路径与薄墙平行也必须留出身体宽度。
  assert.ok(walkPathError({ x: 3.2, y: 2 }, { x: 3.2, y: 4 }, room, obstacles));
});
test("家具、灯具和地毯不挡移动，独立建筑构件仍保留世界坐标碰撞", () => {
  const model = new THREE.Group();
  model.position.set(2, 0, 1);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 3));
  beam.position.y = 2.5;
  beam.userData.wall_id = "beam";
  model.add(beam);
  const rug = new THREE.Mesh(new THREE.BoxGeometry(3, 0.02, 3));
  rug.position.y = 0.02;
  rug.userData.furniture_index = 0;
  model.add(rug);
  assert.equal(buildWalkObstacles(model, 0).length, 0);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  desk.position.set(1, 0.5, 2);
  desk.userData.furniture_index = 1;
  desk.userData.asset_id = "furniture-desk";
  model.add(desk);
  assert.equal(buildWalkObstacles(model, 0).length, 0);
  const route = createWalkRouter([[room]], buildWalkObstacles(model, 0))(
    { x: 1, y: 3 },
    { x: 6, y: 3 },
  );
  assert.equal(route.points.length, 2);
  assert.equal(
    walkPathError(
      { x: 3, y: 3 },
      { x: 6, y: 3 },
      room,
      buildWalkObstacles(model, 0),
    ),
    "",
  );
  delete desk.userData.furniture_index;
  desk.userData.fixture_id = "floor-light";
  assert.equal(buildWalkObstacles(model, 0).length, 0);
  delete desk.userData.fixture_id;
  desk.userData.asset_id = "architecture-column";
  assert.ok(
    walkPathError(
      { x: 1, y: 3 },
      { x: 6, y: 3 },
      room,
      buildWalkObstacles(model, 0),
    ),
  );
});
test("点击容忍小幅手抖，拖动阈值同时覆盖水平与斜向手势", () => {
  assert.equal(dragExceeded({ x: 0, y: 0 }, { x: 3, y: 3 }), false);
  assert.equal(dragExceeded({ x: 0, y: 0 }, { x: 7, y: 0 }), true);
  assert.equal(dragExceeded({ x: 0, y: 0 }, { x: 5, y: 5 }), true);
});
test("运动插值不越过端点，眼高保持固定", () => {
  const a = new THREE.Vector3(1, 1.55, 2),
    b = new THREE.Vector3(5, 1.55, 6);
  assert.deepEqual(walkingPosition(a, b, -1).toArray(), a.toArray());
  assert.deepEqual(walkingPosition(a, b, 2).toArray(), b.toArray());
  const p = walkingPosition(a, b, 0.5);
  assert.equal(p.y, 1.55);
  assert.equal(p.x, 3);
});
test("实际漫游移动成功到达、取消停在中途，失败不改镜头", () => {
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false });
  try {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(1, 1.55, 1);
    let state;
    const tour = new RoomTour({
      camera,
      callbacks: {
        onTour: (v) => {
          state = v;
        },
      },
    });
    tour.active = true;
    tour.yaw = 0.4;
    tour.pitch = -0.2;
    tour.room = { id: "r", floor: 0, polygon: room };
    tour.data = { rooms: [tour.room], portals: [] };
    tour.walkCollision = new Map([["r", []]]);
    tour.hotspots = [];
    tour.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.2),
      new THREE.MeshBasicMaterial(),
    );
    assert.equal(tour.walkTo({ x: 2, y: 1 }), true);
    assert.equal(state.moving, true);
    const step = tour.walking;
    tour.update(step.started + step.duration / 2);
    assert.ok(camera.position.x > 1 && camera.position.x < 2);
    tour.cancelWalking();
    const stopped = camera.position.clone();
    tour.update(step.started + step.duration + 10);
    assert.ok(camera.position.equals(stopped));
    assert.equal(tour.walkTo({ x: 3, y: 1 }), true);
    tour.update(tour.walking.started + tour.walking.duration);
    assert.deepEqual(camera.position.toArray(), [3, 1.55, 1]);
    assert.equal(state.moving, false);
    assert.equal(tour.yaw, 0.4);
    assert.equal(tour.pitch, -0.2);
    assert.equal(tour.walkTo({ x: 9, y: 1 }), false);
    assert.deepEqual(camera.position.toArray(), [3, 1.55, 1]);
  } finally {
    if (previous) globalThis.matchMedia = previous;
    else delete globalThis.matchMedia;
  }
});
