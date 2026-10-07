import { Vector3, MathUtils } from "three";

// Project all eight bounding-box corners onto the current viewing axes.
// Perspective depth matters: a nearby corner needs more space than a far one.
export function frameBounds(
  size,
  direction,
  aspect,
  fov = 35,
  margin = 1.12,
  points = null,
) {
  const forward = direction.clone().normalize();
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), forward);
  if (right.lengthSq() < 1e-10) right.set(1, 0, 0);
  right.normalize();
  const up = new Vector3().crossVectors(forward, right).normalize();
  const tanY = Math.tan(MathUtils.degToRad(fov / 2));
  const tanX = tanY * aspect;
  let distance = 0,
    halfHeight = 0;
  const corners =
    points ||
    [-1, 1].flatMap((x) =>
      [-1, 1].flatMap((y) =>
        [-1, 1].map(
          (z) =>
            new Vector3((x * size.x) / 2, (y * size.y) / 2, (z * size.z) / 2),
        ),
      ),
    );
  for (const point of corners) {
    const horizontal = Math.abs(point.dot(right)),
      vertical = Math.abs(point.dot(up));
    distance = Math.max(
      distance,
      point.dot(forward) + (margin * horizontal) / tanX,
      point.dot(forward) + (margin * vertical) / tanY,
    );
    halfHeight = Math.max(
      halfHeight,
      vertical * margin,
      (horizontal * margin) / aspect,
    );
  }
  return {
    distance: Math.max(distance, 1),
    halfHeight: Math.max(halfHeight, 0.1),
  };
}

export function visualCenter(points, direction) {
  const forward = direction.clone().normalize();
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), forward);
  if (right.lengthSq() < 1e-10) right.set(1, 0, 0);
  right.normalize();
  const up = new Vector3().crossVectors(forward, right).normalize();
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const point of points) {
    const x = point.dot(right),
      y = point.dot(up);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return right
    .multiplyScalar((minX + maxX) / 2)
    .addScaledVector(up, (minY + maxY) / 2);
}

// Center the projected outline, including perspective depth, rather than only
// the model's world-space box. This keeps the empty space balanced on screen.
export function perspectiveCenter(points, direction, aspect, fov = 22) {
  const forward = direction.clone().normalize();
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), forward);
  if (right.lengthSq() < 1e-10) right.set(1, 0, 0);
  right.normalize();
  const up = new Vector3().crossVectors(forward, right).normalize();
  const shift = visualCenter(points, direction);
  for (let iteration = 0; iteration < 6; iteration++) {
    const centered = points.map((point) => point.clone().sub(shift));
    const { distance } = frameBounds(
      new Vector3(),
      direction,
      aspect,
      fov,
      1.12,
      centered,
    );
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const point of centered) {
      const depth = distance - point.dot(forward);
      const x = point.dot(right) / depth,
        y = point.dot(up) / depth;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    shift
      .addScaledVector(right, ((minX + maxX) * distance) / 2)
      .addScaledVector(up, ((minY + maxY) * distance) / 2);
  }
  return shift;
}
