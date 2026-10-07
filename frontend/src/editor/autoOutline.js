import polygonClipping from "polygon-clipping";
import {
  polygonArea,
  polygonInside,
  segmentInside,
  simplePolygon,
} from "./geometry.js";

// Match the square caps used by backend/app/architecture.py. Furniture, lights,
// finishes and openings never contribute to the building footprint.
const ring = (points) => [points.map(({ x, y }) => [x, y])];
const validPoint = (p) => Number.isFinite(p.x) && Number.isFinite(p.y);
export const MAX_OUTLINE_POINTS = 512;

export function sameArchitecture(a, b) {
  const shape = (layout) => ({
    rooms: layout.rooms.map(({ id, polygon }) => ({ id, polygon })),
    walls: layout.walls.map(({ id, start, end, thickness }) => ({
      id,
      start,
      end,
      thickness,
    })),
  });
  return JSON.stringify(shape(a)) === JSON.stringify(shape(b));
}

export function deriveOutline(layout) {
  const shapes = [];
  for (const [index, room] of layout.rooms.entries()) {
    if (!room.polygon.every(validPoint) || !simplePolygon(room.polygon))
      return {
        issue: {
          type: "rooms",
          index,
          text: `${room.name} 边界无效，请修正角点后自动适配轮廓。`,
        },
      };
    shapes.push(ring(room.polygon));
  }
  for (const [index, wall] of layout.walls.entries()) {
    const dx = wall.end.x - wall.start.x,
      dy = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dy),
      half = wall.thickness / 2;
    if (
      !validPoint(wall.start) ||
      !validPoint(wall.end) ||
      length < 0.05 ||
      !Number.isFinite(half) ||
      half <= 0
    )
      return {
        issue: {
          type: "walls",
          index,
          text: `墙体 ${index + 1} 几何无效，请修正端点后自动适配轮廓。`,
        },
      };
    const ux = (dx / length) * half,
      uy = (dy / length) * half;
    shapes.push(
      ring([
        { x: wall.start.x - ux - uy, y: wall.start.y - uy + ux },
        { x: wall.end.x + ux - uy, y: wall.end.y + uy + ux },
        { x: wall.end.x + ux + uy, y: wall.end.y + uy - ux },
        { x: wall.start.x - ux + uy, y: wall.start.y - uy - ux },
      ]),
    );
  }
  // Clearing every indoor object leaves the existing empty base available.
  if (!shapes.length) return { outline: layout.outline };
  try {
    const polygons = polygonClipping
      .union(...shapes)
      .map((polygon) => polygon[0].slice(0, -1).map(([x, y]) => ({ x, y })))
      .sort((a, b) => polygonArea(b) - polygonArea(a));
    const outline = polygons[0];
    // A closed wall network can enclose separate floor islands. They are valid
    // inside its outer ring; detached geometry outside it must not be bridged.
    if (polygons.some((polygon) => !polygonInside(polygon, outline))) {
      const roomIndex = layout.rooms.findIndex(
        (room) => !polygonInside(room.polygon, outline),
      );
      const wallIndex = layout.walls.findIndex(
        (wall) => !segmentInside(wall.start, wall.end, outline),
      );
      return {
        issue:
          roomIndex >= 0
            ? {
                type: "rooms",
                index: roomIndex,
                text: `${layout.rooms[roomIndex].name} 与户型主体脱离，请连接空间或墙体后自动适配轮廓。`,
              }
            : {
                type: "walls",
                index: Math.max(0, wallIndex),
                text: `墙体 ${Math.max(0, wallIndex) + 1} 与户型主体脱离，请连接墙体后自动适配轮廓。`,
              },
      };
    }
    if (
      !simplePolygon(outline) ||
      polygonArea(outline) < 2 ||
      outline.length > MAX_OUTLINE_POINTS ||
      outline.some((p) => Math.abs(p.x) > 60 || Math.abs(p.y) > 60)
    )
      return {
        issue: {
          type: "outline",
          index: 0,
          text: "无法自动适配轮廓：请检查墙体与空间是否自接触、面积不足 2 ㎡、超出坐标范围或边界过于复杂。",
        },
      };
    return { outline };
  } catch {
    return {
      issue: {
        type: "outline",
        index: 0,
        text: "无法自动适配轮廓，请检查墙体端点与空间角点。",
      },
    };
  }
}

export function fitOutline(previous, next) {
  if (sameArchitecture(previous.layout, next.layout)) return next;
  const { outline } = deriveOutline(next.layout);
  return outline ? { ...next, layout: { ...next.layout, outline } } : next;
}
