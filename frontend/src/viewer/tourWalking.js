import * as THREE from "three";
import polygonClipping from "polygon-clipping";
import { insideRoom, edgeDistance } from "./tourGeometry.js";

export const WALK_RADIUS = 0.22;

export function isWalkThroughObject(data) {
  return (
    (data.furniture_index != null || !!data.fixture_id) &&
    !data.architecture_network &&
    !data.boundary_glass
  );
}

export function buildWalkRegions(rooms, portals, current) {
  const connected = new Set([current.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of portals)
      if (p.rooms.some((id) => connected.has(id)))
        for (const id of p.rooms) {
          const room = rooms.find((r) => r.id === id);
          if (
            room &&
            Math.abs(room.floor - current.floor) < 0.04 &&
            !connected.has(id)
          ) {
            connected.add(id);
            changed = true;
          }
        }
  }
  const polygons = rooms
    .filter((r) => connected.has(r.id))
    .map((r) => [
      r.polygon.map((p) => [
        Math.round(p.x * 1e5) / 1e5,
        Math.round(p.y * 1e5) / 1e5,
      ]),
    ]);
  for (const portal of portals) {
    if (!portal.rooms.every((id) => connected.has(id))) continue;
    for (const bridge of portal.bridges || []) {
      if (
        bridge.length >= 3 &&
        bridge.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      )
        polygons.push([
          bridge.map((p) => [
            Math.round(p.x * 1e5) / 1e5,
            Math.round(p.y * 1e5) / 1e5,
          ]),
        ]);
    }
  }
  try {
    return polygonClipping
      .union(...polygons)
      .map((p) => p.map((ring) => ring.map(([x, y]) => ({ x, y }))));
  } catch {
    return [[current.polygon]];
  }
}

export function walkAreaError(from, to, regions, obstacles) {
  const region = regions.find(
    (r) => insideRoom(from, r[0]) && insideRoom(to, r[0]),
  );
  if (!region) return "这里没有连通的地面，请从门洞或开放通道通过。";
  const error = walkPathError(from, to, region[0], obstacles);
  if (error) return error;
  if (region.slice(1).some((hole) => hitsPolygon(from, to, hole, WALK_RADIUS)))
    return "路线经过没有地面的区域，请换个落点。";
  return "";
}
const cross = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function segmentDistance(a, b, c, d) {
  if (
    cross(a, b, c) * cross(a, b, d) < 0 &&
    cross(c, d, a) * cross(c, d, b) < 0
  )
    return 0;
  return Math.min(
    edgeDistance(a, c, d),
    edgeDistance(b, c, d),
    edgeDistance(c, a, b),
    edgeDistance(d, a, b),
  );
}
function hitsPolygon(a, b, polygon, radius) {
  if (insideRoom(a, polygon) || insideRoom(b, polygon)) return true;
  return polygon.some(
    (p, i) =>
      segmentDistance(a, b, p, polygon[(i + 1) % polygon.length]) < radius,
  );
}

// 连续线段与边界/障碍物求距离，不用稀疏采样，薄墙也不能跨过去。
export function walkPathError(
  from,
  to,
  polygon,
  obstacles,
  radius = WALK_RADIUS,
) {
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite))
    return "请选择脚下的地面。";
  if (!insideRoom(from, polygon) || !insideRoom(to, polygon))
    return "请选择有地面连接的门洞或通道。";
  if (
    polygon.some(
      (p, i) =>
        segmentDistance(from, to, p, polygon[(i + 1) % polygon.length]) <
        radius,
    )
  )
    return "这里靠墙太近，或路线会经过墙角，请换个落点。";
  const minX = Math.min(from.x, to.x) - radius,
    maxX = Math.max(from.x, to.x) + radius;
  const minY = Math.min(from.y, to.y) - radius,
    maxY = Math.max(from.y, to.y) + radius;
  for (const obstacle of obstacles) {
    if (
      obstacle.maxX < minX ||
      obstacle.minX > maxX ||
      obstacle.maxY < minY ||
      obstacle.minY > maxY
    )
      continue;
    if (hitsPolygon(from, to, obstacle.polygon, radius))
      return "前方有墙体或建筑构件挡路，请换个落点。";
  }
  return "";
}

function clipHeight(points, height, above) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const ina = above ? a.y >= height : a.y <= height,
      inb = above ? b.y >= height : b.y <= height;
    if (ina) result.push(a);
    if (ina !== inb)
      result.push(a.clone().lerp(b, (height - a.y) / (b.y - a.y)));
  }
  return result;
}
export function buildWalkObstacles(model, floor) {
  const obstacles = [];
  const add = (polygon) => {
    if (polygon.length < 2) return;
    obstacles.push({
      polygon,
      minX: Math.min(...polygon.map((p) => p.x)),
      maxX: Math.max(...polygon.map((p) => p.x)),
      minY: Math.min(...polygon.map((p) => p.y)),
      maxY: Math.max(...polygon.map((p) => p.y)),
    });
  };
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const d = o.userData;
    // 漫游允许穿过家具和灯具；独立建筑构件、墙体和玻璃仍保留碰撞。
    if (isWalkThroughObject(d)) return;
    if (
      d.asset_id &&
      !d.wall_id &&
      !d.architecture_network &&
      !d.boundary_glass
    ) {
      const b = new THREE.Box3().setFromObject(o);
      if (b.max.y > floor + 0.12 && b.min.y < floor + 1.8)
        add([
          { x: b.min.x, y: b.min.z },
          { x: b.max.x, y: b.min.z },
          { x: b.max.x, y: b.max.z },
          { x: b.min.x, y: b.max.z },
        ]);
    } else if (d.wall_id || d.architecture_network || d.boundary_glass) {
      // 合并墙网不能取整栋包围盒。裁出人体高度带内的实际三角形投影。
      const position = o.geometry.attributes.position,
        index = o.geometry.index;
      if (!position) return;
      const count = index?.count || position.count;
      for (let i = 0; i < count; i += 3) {
        let triangle = [0, 1, 2].map((k) =>
          new THREE.Vector3()
            .fromBufferAttribute(position, index ? index.getX(i + k) : i + k)
            .applyMatrix4(o.matrixWorld),
        );
        triangle = clipHeight(triangle, floor + 0.12, true);
        triangle = clipHeight(triangle, floor + 1.8, false);
        add(triangle.map((p) => ({ x: p.x, y: p.z })));
      }
    }
  });
  return obstacles;
}

export function dragExceeded(start, point) {
  return Math.hypot(point.x - start.x, point.y - start.y) > 6;
}

export function walkingPosition(from, to, fraction) {
  const t = Math.max(0, Math.min(1, fraction)),
    eased = t * t * (3 - 2 * t);
  return from.clone().lerp(to, eased);
}
