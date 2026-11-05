import polygonClipping from "polygon-clipping";
export const polygonArea = (points) =>
  Math.abs(
    points.reduce((sum, a, i) => {
      const b = points[(i + 1) % points.length];
      return sum + a.x * b.y - b.x * a.y;
    }, 0) / 2,
  );
export function furnitureCorners(item) {
  const angle = (item.rotation * Math.PI) / 180;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([dx, dy]) => ({
    x:
      item.x +
      (Math.cos(angle) * dx * item.width) / 2 -
      (Math.sin(angle) * dy * item.depth) / 2,
    y:
      item.y +
      (Math.sin(angle) * dx * item.width) / 2 +
      (Math.cos(angle) * dy * item.depth) / 2,
  }));
}
export const clipRing = (points) => [points.map((p) => [p.x, p.y])];
export function overlapArea(a, b) {
  return polygonClipping
    .intersection(clipRing(a), clipRing(b))
    .reduce(
      (sum, poly) =>
        sum +
        poly.reduce(
          (area, ring, i) =>
            area + (i ? -1 : 1) * polygonArea(ring.map(([x, y]) => ({ x, y }))),
          0,
        ),
      0,
    );
}
