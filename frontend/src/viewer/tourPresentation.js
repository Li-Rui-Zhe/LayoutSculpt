import { insideRoom } from "./tourGeometry.js";

const yawTo = (from, to) => Math.atan2(to.x - from.x, -(to.y - from.y));
const centerOf = (room) =>
  room.polygon.reduce(
    (p, v) => ({
      x: p.x + v.x / room.polygon.length,
      y: p.y + v.y / room.polygon.length,
    }),
    { x: 0, y: 0 },
  );

export function arrivalYaw(room, station, data, furnitureTargets = []) {
  // 露台默认看向相连室内空间，不再看着栏杆或户外空白。
  if (/阳台|露台|庭院|balcony|terrace|patio/i.test(room.name || "")) {
    const neighbors = data.portals
      .filter((p) => p.rooms.includes(room.id))
      .flatMap((p) => p.rooms)
      .filter((id) => id !== room.id);
    const inside = data.rooms.filter(
      (r) =>
        neighbors.includes(r.id) &&
        !/阳台|露台|庭院|balcony|terrace|patio/i.test(r.name || ""),
    );
    const targetRoom =
      inside.find((r) => /客厅|客餐|起居|living/i.test(r.name || "")) ||
      inside[0];
    if (targetRoom) {
      const center = centerOf(targetRoom);
      const target = insideRoom(center, targetRoom.polygon)
        ? center
        : targetRoom.stations?.[0];
      if (target) return yawTo(station, target);
    }
  }
  const center = centerOf(room);
  const targets = [
    ...furnitureTargets.filter((p) => insideRoom(p, room.polygon)),
    center,
  ].filter(
    (p) =>
      insideRoom(p, room.polygon) &&
      Math.hypot(p.x - station.x, p.y - station.y) > 0.8,
  );
  const candidates = [
    ...targets.map((p) => yawTo(station, p)),
    ...Array.from({ length: 32 }, (_, i) => (i * Math.PI) / 16),
  ];
  const reach = (yaw) => {
    for (let distance = 0.2; distance <= 20; distance += 0.2)
      if (
        !insideRoom(
          {
            x: station.x + Math.sin(yaw) * distance,
            y: station.y - Math.cos(yaw) * distance,
          },
          room.polygon,
        )
      )
        return distance;
    return 20;
  };
  let bestYaw = 0,
    bestScore = -Infinity;
  for (const yaw of candidates) {
    const depth = reach(yaw);
    const openness = Math.min(reach(yaw - 0.45), reach(yaw + 0.45));
    const focus = Math.max(
      0,
      ...targets.map((p) => Math.cos(yaw - yawTo(station, p))),
    );
    const score = depth * 0.55 + openness * 0.45 + focus * 0.7;
    if (score > bestScore) {
      bestScore = score;
      bestYaw = yaw;
    }
  }
  return bestYaw;
}

export function nearbyPortal(distance, alreadyVisible = false) {
  return distance >= 0.3 && distance <= (alreadyVisible ? 2.8 : 2.4);
}
