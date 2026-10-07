import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, PerspectiveCamera } from "three";
import {
  frameBounds,
  visualCenter,
  perspectiveCenter,
} from "../src/viewer/viewFraming.js";

test("默认取景完整包含横向、纵向与手机画布中的长户型", () => {
  for (const aspect of [0.55, 1, 1.8, 2.5])
    for (const size of [
      new Vector3(16, 3, 7),
      new Vector3(7, 3, 16),
      new Vector3(10, 3, 10),
    ]) {
      const direction = new Vector3(0.9, 1.6, 1.25).normalize();
      const frame = frameBounds(size, direction, aspect);
      const camera = new PerspectiveCamera(35, aspect, 0.1, 1000);
      camera.position.copy(direction).multiplyScalar(frame.distance);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      let largest = 0;
      for (const x of [-1, 1])
        for (const y of [-1, 1])
          for (const z of [-1, 1]) {
            const point = new Vector3(
              (x * size.x) / 2,
              (y * size.y) / 2,
              (z * size.z) / 2,
            ).project(camera);
            assert.ok(
              Math.abs(point.x) <= 0.91 && Math.abs(point.y) <= 0.91,
              `${aspect}: ${point.toArray()}`,
            );
            largest = Math.max(largest, Math.abs(point.x), Math.abs(point.y));
          }
      assert.ok(
        largest >= 0.75,
        "模型必须充分使用可用画布，不能缩成很小的预览",
      );
    }
});

test("透视取景的实际投影居中，并保留四周完整边界", () => {
  const points = [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((z) => [0, 1.2].map((y) => new Vector3(x * 4, y, z * 7))),
  );
  points.push(new Vector3(2, 3, 4));
  const direction = new Vector3(1.85, 3.1, 0.55).normalize();
  for (const aspect of [0.5, 1, 1.8]) {
    const target = perspectiveCenter(points, direction, aspect);
    const { distance } = frameBounds(
      new Vector3(),
      direction,
      aspect,
      22,
      1.12,
      points.map((p) => p.clone().sub(target)),
    );
    const camera = new PerspectiveCamera(22, aspect, 0.1, 1000);
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const projected = points.map((p) => p.clone().project(camera));
    for (const axis of ["x", "y"]) {
      const values = projected.map((p) => p[axis]);
      assert.ok(Math.abs(Math.min(...values) + Math.max(...values)) < 0.003);
      assert.ok(values.every((v) => Math.abs(v) < 0.91));
    }
  }
});

test("根据可见构件取景时，稀疏的高灯具不会给整个户型增加虚假的边界", () => {
  const points = [-1, 1].flatMap((x) =>
    [-1, 1].map((z) => new Vector3(x * 4, 0, z * 7)),
  );
  points.push(new Vector3(0, 3, 0));
  const direction = new Vector3(1.85, 2.4, 0.32).normalize();
  const target = visualCenter(points, direction);
  const centered = points.map((point) => point.clone().sub(target));
  const frame = frameBounds(
    new Vector3(8, 3, 14),
    direction,
    1.8,
    35,
    1.12,
    centered,
  );
  const camera = new PerspectiveCamera(35, 1.8, 0.1, 1000);
  camera.position.copy(target).addScaledVector(direction, frame.distance);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  for (const point of points) {
    const p = point.clone().project(camera);
    assert.ok(Math.abs(p.x) < 0.91 && Math.abs(p.y) < 0.91);
  }
  assert.ok(
    frame.distance <
      frameBounds(new Vector3(8, 3, 14), direction, 1.8).distance,
  );
});
