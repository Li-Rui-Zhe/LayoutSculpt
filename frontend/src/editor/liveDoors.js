import * as THREE from "three";
import { openingParts } from "./openingVisuals.js";
import { planOrigin } from "./liveModel.js";
import { previewKey } from "./previewIdentity.js";

const poseKeys = ["angle", "hinge", "swing"];
const shape = (o) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !poseKeys.includes(k)));

// 仅已绑定的门扇支持本地变换。洞口、墙体或款式变化仍交给建模器。
export function doorPoseSnapshot(base, current, indices = []) {
  if (!base || !current) return base;
  const openings = base.layout.openings.map((o, i) => {
    const next = current.layout.openings[i];
    if (
      !indices.includes(i) ||
      !next ||
      previewKey(shape(o)) !== previewKey(shape(next))
    )
      return o;
    const wall = base.layout.walls.find((w) => w.id === o.wall_id);
    const nextWall = current.layout.walls.find((w) => w.id === next.wall_id);
    if (!wall || previewKey(wall) !== previewKey(nextWall)) return o;
    return {
      ...shape(o),
      ...Object.fromEntries(
        poseKeys.filter((key) => key in next).map((key) => [key, next[key]]),
      ),
    };
  });
  return { ...base, layout: { ...base.layout, openings } };
}

export function canSyncDoorPoses(base, current, indices) {
  return (
    previewKey(doorPoseSnapshot(base, current, indices)) === previewKey(current)
  );
}

function partsFor(opening, wall, origin) {
  const dx = wall.end.x - wall.start.x,
    dz = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dz),
    angle = -Math.atan2(dz, dx);
  if (length < 0.001) return [];
  const simple =
    (opening.door_style || "hinged") === "hinged" &&
    (opening.door_material || "wood") === "wood" &&
    (opening.window_style || "fixed") === "fixed" &&
    (opening.glass_type || "clear") === "clear";
  if (simple) {
    const end = opening.hinge === "end";
    const at = opening.offset + (end ? opening.width : 0);
    const rotation =
      angle +
      (end ? Math.PI : 0) +
      THREE.MathUtils.degToRad(opening.angle ?? 90) *
        (opening.swing === "right" ? -1 : 1);
    const width = Math.max(0.03, opening.width - 0.04);
    return [
      {
        name: "门扇_",
        rotation,
        center: new THREE.Vector3(
          wall.start.x +
            (dx * at) / length -
            origin.x +
            (Math.cos(rotation) * width) / 2,
          opening.height / 2,
          wall.start.y +
            (dz * at) / length -
            origin.y -
            (Math.sin(rotation) * width) / 2,
        ),
      },
    ];
  }
  return openingParts(opening, wall.thickness).map((p) => {
    const at = opening.offset + p.position[0],
      depth = p.position[2];
    return {
      name: p.name,
      rotation: angle + p.angle,
      center: new THREE.Vector3(
        wall.start.x + (dx * at - dz * depth) / length - origin.x,
        p.position[1],
        wall.start.y + (dz * at + dx * depth) / length - origin.y,
      ),
    };
  });
}

export function bindLiveDoors(model, document) {
  const bindings = new Map(),
    origin = planOrigin(document);
  model.updateMatrixWorld(true);
  const inverse = model.matrixWorld.clone().invert();
  document.layout.openings.forEach((opening, index) => {
    if (
      opening.kind !== "door" ||
      opening.door_leaf === false ||
      opening.door_style === "sliding"
    )
      return;
    const wall = document.layout.walls.find((w) => w.id === opening.wall_id);
    if (!wall) return;
    const parts = partsFor(opening, wall, origin),
      nodes = [];
    let unsupported = false,
      leaves = 0;
    model.traverse((node) => {
      if (
        !node.isMesh ||
        node.userData.editor_proxy ||
        node.userData.opening_index !== index
      )
        return;
      // 固定门套不旋转；玻璃门的扇框、把手与门扇一起移动。
      const moving = /^(门扇_|单开门扇|双开门扇|扇竖框|扇横框|把手)/.test(
        node.name,
      );
      if (!moving) return;
      const matrix = new THREE.Matrix4().multiplyMatrices(
        inverse,
        node.matrixWorld,
      );
      node.geometry.computeBoundingBox();
      const center = node.geometry.boundingBox
        .getCenter(new THREE.Vector3())
        .applyMatrix4(matrix);
      const candidates = parts
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => node.name.startsWith(p.name));
      candidates.sort(
        (a, b) =>
          a.p.center.distanceToSquared(center) -
          b.p.center.distanceToSquared(center),
      );
      const match = candidates[0];
      if (
        !match ||
        Math.hypot(match.p.center.x - center.x, match.p.center.z - center.z) >
          0.015
      ) {
        unsupported = true;
        return;
      }
      nodes.push({ node, matrix, part: match.i });
      if (/^(门扇_|单开门扇|双开门扇)/.test(node.name)) leaves++;
    });
    const movingParts = parts
      .map((part, i) => ({ part, i }))
      .filter(({ part }) =>
        /^(门扇_|单开门扇|双开门扇|扇竖框|扇横框|把手)/.test(part.name),
      );
    if (
      !unsupported &&
      leaves &&
      movingParts.every(({ i }) => nodes.some((node) => node.part === i))
    )
      bindings.set(index, { model, opening, wall, parts, nodes, origin });
  });
  return bindings;
}

export function syncLiveDoors(bindings, base, current) {
  const snapshot = doorPoseSnapshot(base, current, [...bindings.keys()]);
  for (const [index, binding] of bindings) {
    const { model, wall, parts, nodes, origin } = binding;
    const next = partsFor(snapshot.layout.openings[index], wall, origin);
    model.updateMatrixWorld(true);
    for (const { node, matrix, part } of nodes) {
      const from = parts[part],
        to = next[part];
      const transform = new THREE.Matrix4()
        .makeTranslation(to.center.x, 0, to.center.z)
        .multiply(
          new THREE.Matrix4().makeRotationY(to.rotation - from.rotation),
        )
        .multiply(
          new THREE.Matrix4().makeTranslation(
            -from.center.x,
            0,
            -from.center.z,
          ),
        )
        .multiply(matrix);
      const local = node.parent.matrixWorld
        .clone()
        .invert()
        .multiply(model.matrixWorld)
        .multiply(transform);
      local.decompose(node.position, node.quaternion, node.scale);
      node.updateMatrix();
    }
    model.updateMatrixWorld(true);
  }
}
