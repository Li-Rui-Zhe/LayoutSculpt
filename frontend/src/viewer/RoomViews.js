import * as THREE from "three";
import { arrivalYaw } from "./tourPresentation.js";
import { insideRoom } from "./tourGeometry.js";

const priority = (name) => {
  const groups = [
    /客厅|客餐|起居|living/i,
    /餐厅|dining/i,
    /主卧|master/i,
    /卧室|次卧|bedroom/i,
    /书房|study/i,
  ];
  const index = groups.findIndex((pattern) => pattern.test(name));
  return index < 0 ? groups.length : index;
};

export function recommendedRooms(rooms) {
  return rooms
    .filter(
      (r) =>
        r.stations?.length &&
        !/卫生|浴室|厕所|阳台|露台|储物|bath|toilet|balcony|terrace|storage/i.test(
          r.name,
        ),
    )
    .map((room, order) => ({ room, order }))
    .sort(
      (a, b) =>
        priority(a.room.name) - priority(b.room.name) || a.order - b.order,
    )
    .slice(0, 4)
    .map(({ room }) => ({ id: room.id, name: room.name }));
}

// 每次进入漫游仅构建一次包围盒；房间视角按需计算、缓存，不做逐帧射线检测。
export class RoomViews {
  constructor(model, data, canStand) {
    this.data = data;
    this.canStand = canStand;
    this.cache = new Map();
    this.boxes = [];
    this.structures = [];
    this.targets = [];
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (
        !o.isMesh ||
        !o.geometry ||
        o.userData.structure_kind === "room" ||
        o.userData.fixture_id
      )
        return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const box = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      if (box.isEmpty()) return;
      // 使用真实结构，即使鸟瞰剖面隐藏墙体，也不推荐墙内镜头。
      if (
        o.userData.wall_id ||
        o.userData.architecture_network ||
        o.userData.boundary_glass
      ) {
        // 连续墙体常合并为一个全屋网格，不能把整个包围盒当成实心障碍。
        const positions = o.geometry.attributes.position,
          index = o.geometry.index;
        const triangles = [];
        for (let i = 0; i + 2 < (index?.count ?? positions.count); i += 3) {
          triangles.push(
            [0, 1, 2].map((k) =>
              new THREE.Vector3()
                .fromBufferAttribute(
                  positions,
                  index ? index.getX(i + k) : i + k,
                )
                .applyMatrix4(o.matrixWorld),
            ),
          );
        }
        this.structures.push({ box, triangles });
      } else this.boxes.push(box);
      if (
        o.userData.furniture_index != null &&
        !o.userData.architecture_network
      ) {
        const c = box.getCenter(new THREE.Vector3());
        if (this.targets.every((p) => Math.hypot(p.x - c.x, p.y - c.z) > 0.8))
          this.targets.push({ x: c.x, y: c.z });
      }
    });
  }
  get(room) {
    if (this.cache.has(room.id)) return this.cache.get(room.id);
    const ray = new THREE.Ray(),
      hit = new THREE.Vector3();
    const targets = this.targets.filter((p) => insideRoom(p, room.polygon));
    let best = null;
    for (const station of room.stations) {
      if (!this.canStand(room, station)) continue;
      const eye = new THREE.Vector3(station.x, station.height, station.y);
      if (
        this.boxes.some((box) =>
          box.clone().expandByScalar(0.12).containsPoint(eye),
        )
      )
        continue;
      const preferred = arrivalYaw(room, station, this.data, targets);
      const yaws = [
        preferred,
        ...Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8),
      ];
      for (const yaw of yaws) {
        const distances = [-0.45, -0.23, 0, 0.23, 0.45].map((offset) => {
          const angle = yaw + offset;
          // 房间边界限定景深，避免把窗外空白误判为最佳方向。
          let distance = 0.25;
          while (
            distance < 8 &&
            insideRoom(
              {
                x: station.x + Math.sin(angle) * distance,
                y: station.y - Math.cos(angle) * distance,
              },
              room.polygon,
            )
          )
            distance += 0.25;
          ray.set(
            eye,
            new THREE.Vector3(
              Math.sin(angle),
              -0.08,
              -Math.cos(angle),
            ).normalize(),
          );
          for (const box of this.boxes) {
            if (ray.intersectBox(box, hit))
              distance = Math.min(distance, eye.distanceTo(hit));
          }
          for (const structure of this.structures) {
            if (!ray.intersectsBox(structure.box)) continue;
            for (const [a, b, c] of structure.triangles) {
              if (
                Math.max(a.y, b.y, c.y) < eye.y - 0.8 ||
                Math.min(a.y, b.y, c.y) > eye.y
              )
                continue;
              if (ray.intersectTriangle(a, b, c, false, hit))
                distance = Math.min(distance, eye.distanceTo(hit));
            }
          }
          return distance;
        });
        if (distances[2] < 0.85 || Math.min(...distances) < 0.4) continue;
        const subject = targets.length
          ? Math.max(
              ...targets.map((p) =>
                Math.cos(yaw - Math.atan2(p.x - station.x, -(p.y - station.y))),
              ),
            )
          : 0;
        const score =
          distances.reduce((sum, d) => sum + Math.min(d, 6), 0) / 5 +
          Math.min(...distances) * 0.5 +
          subject * 0.6 +
          Math.cos(yaw - preferred) * 0.15;
        if (!best || score > best.score)
          best = { station, yaw, pitch: -0.08, fov: 62, score };
      }
    }
    this.cache.set(room.id, best);
    return best;
  }
}
