import * as THREE from "three";
import { floorBoundary } from "./roomIsolation.js";
import { isWalkThroughObject } from "./tourWalking.js";
import {
  connectPortals,
  standPoints,
  insideRoom,
  roomClearance,
} from "./tourGeometry.js";

// 开放客餐厨没有门框：只在共边且实际几何没有阻挡时补充通行点。
function openConnections(rooms, model, existing) {
  const blockers = [];
  model.traverse((o) => {
    if (isWalkThroughObject(o.userData)) return;
    if (
      o.isMesh &&
      (o.userData.wall_id ||
        o.userData.architecture_network ||
        o.userData.boundary_glass ||
        o.userData.asset_id)
    )
      blockers.push(o);
  });
  const ray = new THREE.Raycaster(),
    result = [];
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i],
        b = rooms[j];
      if (
        existing.some((p) => p.rooms.includes(a.id) && p.rooms.includes(b.id))
      )
        continue;
      let found = null;
      const bridges = [];
      for (let k = 0; k < a.polygon.length; k++) {
        const start = a.polygon[k],
          end = a.polygon[(k + 1) % a.polygon.length];
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        if (length < 0.8) continue;
        const dx = (end.x - start.x) / length,
          dy = (end.y - start.y) / length;
        const normal = [-dy, dx];
        for (let t = 0.4; t < length - 0.39; t += 0.5) {
          const p = { x: start.x + dx * t, y: start.y + dy * t };
          if (roomClearance(p, b.polygon) > 0.25) continue;
          const links = connectPortals(
            [a, b],
            [{ id: "open", kind: "passage", normal, ...p }],
          );
          if (!links.length) continue;
          let clear = true;
          for (const offset of [-0.3, 0, 0.3]) {
            const x = p.x + dx * offset,
              y = p.y + dy * offset;
            const side1 = { x: x - normal[0] * 0.35, y: y - normal[1] * 0.35 };
            const side2 = { x: x + normal[0] * 0.35, y: y + normal[1] * 0.35 };
            if (!(
              (insideRoom(side1, a.polygon) && insideRoom(side2, b.polygon)) ||
              (insideRoom(side2, a.polygon) && insideRoom(side1, b.polygon))
            )) {
              clear = false;
              break;
            }
            for (const height of [0.25, 0.85, 1.5]) {
              ray.set(
                new THREE.Vector3(
                  side1.x,
                  Math.max(a.floor, b.floor) + height,
                  side1.y,
                ),
                new THREE.Vector3(normal[0], 0, normal[1]),
              );
              ray.far = 0.7;
              if (ray.intersectObjects(blockers, false).length) {
                clear = false;
                break;
              }
            }
            if (!clear) break;
          }
          if (clear) {
            // 收集整段已验证的开放边界，不只在热点按钮脚下留一个窄出口。
            bridges.push(
              [
                [-0.3, -0.35],
                [0.3, -0.35],
                [0.3, 0.35],
                [-0.3, 0.35],
              ].map(([along, across]) => ({
                x: p.x + dx * along + normal[0] * across,
                y: p.y + dy * along + normal[1] * across,
              })),
            );
            found ||= {
              id: `open:${a.id}:${b.id}`,
              kind: "passage",
              ...p,
              height: a.floor + 0.8,
              normal,
              rooms: [a.id, b.id],
            };
          }
        }
      }
      if (found) result.push({ ...found, bridges });
    }
  return result;
}

// 已确认门洞：仅连接门洞宽度内、两侧能落在房间地面的短门槛。
// 真正的门板、门框和玻璃依然交给实际几何碰撞，不把整条房间边界放开。
function doorBridge(portal, rooms) {
  if (!portal.normal || !Number.isFinite(portal.width) || portal.width <= 0.44)
    return [];
  const length = Math.hypot(...portal.normal);
  const nx = portal.normal[0] / length,
    ny = portal.normal[1] / length;
  const half = portal.width / 2;
  const sides = [-1, 1].map((sign) => {
    const room = rooms.find((r) => r.id === portal.rooms[sign < 0 ? 0 : 1]);
    if (!room) return null;
    // 深入地板一些，使路径安全半径不会被拼接端点卡住。
    for (let depth = 0.3; depth <= 0.9; depth += 0.05) {
      const points = [-half, half].map((offset) => ({
        x: portal.x + sign * nx * depth - ny * offset,
        y: portal.y + sign * ny * depth + nx * offset,
      }));
      if (points.every((p) => insideRoom(p, room.polygon))) return points;
    }
    return null;
  });
  return sides.every(Boolean)
    ? [[...sides[0], ...sides[1].slice().reverse()]]
    : [];
}

export function buildTour(model) {
  const rooms = [],
    obstacles = [],
    openings = new Map();
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const d = o.userData,
      bounds = new THREE.Box3().setFromObject(o);
    if (d.structure_kind === "room") {
      const polygon = floorBoundary(o).map((p) => ({ x: p.x, y: p.y }));
      if (polygon.length >= 3 && !rooms.some((r) => r.id === d.room_id))
        rooms.push({
          id: d.room_id,
          name: d.room_name || o.name,
          polygon,
          floor: bounds.max.y,
        });
    }
    // 按实际几何排除家具、落地灯和独立建筑构件；地毯不挡站位。
    if (
      (d.furniture_index != null || d.fixture_id || d.asset_id) &&
      bounds.max.y > 0.18 &&
      bounds.min.y < 1.8
    ) {
      obstacles.push({
        minX: bounds.min.x,
        maxX: bounds.max.x,
        minY: bounds.min.z,
        maxY: bounds.max.z,
      });
    }
    if (
      ["door", "passage"].includes(d.opening_kind) &&
      d.opening_index != null &&
      !/门扇|门板|把手|合页/.test(o.name)
    ) {
      const key = `${d.wall_id}:${d.opening_index}`;
      if (!openings.has(key)) {
        const normal = d.wall_normal
          ? new THREE.Vector3(
              d.wall_normal[0],
              0,
              d.wall_normal[1],
            ).transformDirection(model.matrixWorld)
          : null;
        openings.set(key, {
          id: key,
          kind: d.opening_kind,
          normal: normal && [normal.x, normal.z],
          bounds: new THREE.Box3(),
        });
      }
      openings.get(key).bounds.union(bounds);
    }
  });
  for (const room of rooms)
    room.stations = standPoints(room.polygon, obstacles).map((p, i) => ({
      ...p,
      id: `${room.id}:${i}`,
      height: room.floor + 1.55,
    }));
  const available = rooms.filter((r) => r.stations.length);
  const portals = connectPortals(
    available,
    [...openings.values()].map((o) => {
      const p = o.bounds.getCenter(new THREE.Vector3());
      const size = o.bounds.getSize(new THREE.Vector3());
      return {
        id: o.id,
        kind: o.kind,
        normal: o.normal,
        width: o.normal
          ? Math.abs(o.normal[1]) * size.x + Math.abs(o.normal[0]) * size.z
          : 0,
        x: p.x,
        y: p.z,
        height: Math.max(0.7, Math.min(1.1, p.y)),
      };
    }),
  );
  for (const portal of portals) portal.bridges = doorBridge(portal, available);
  portals.push(...openConnections(available, model, portals));
  return { rooms, available, portals };
}
