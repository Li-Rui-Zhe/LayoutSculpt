import * as THREE from "three";
import { planOrigin } from "./liveModel.js";

export function isRoomFloorHit(data) {
  if (data.live_selection) return data.live_selection.type === "rooms";
  return (
    !!data.room_id &&
    data.furniture_index == null &&
    data.opening_index == null &&
    !data.wall_id &&
    !data.wall_ids?.length &&
    !data.fixture_id &&
    !data.fixture_owner_id
  );
}

export function clearRoomHighlight(rt) {
  if (rt.roomHighlight) {
    rt.scene.remove(rt.roomHighlight);
    rt.roomHighlight.traverse((node) => {
      node.geometry?.dispose();
      node.material?.dispose();
    });
    rt.roomHighlight = null;
  }
  rt.roomHighlightKey = null;
}

// Preview-only geometry: never part of the design document or exported model.
export function updateRoomHighlight(rt, document, selection) {
  const room =
    selection?.type === "rooms" && document?.layout.rooms[selection.index];
  if (!room || room.edit_hidden || room.polygon.length < 3) {
    clearRoomHighlight(rt);
    return;
  }
  const origin = rt.liveOrigin || planOrigin(document);
  const key = JSON.stringify([
    room.id,
    room.polygon,
    room.floor_enabled,
    origin,
  ]);
  if (key === rt.roomHighlightKey) return;
  clearRoomHighlight(rt);
  const group = new THREE.Group();
  group.userData.roomId = room.id;
  group.name = "selected-room-highlight";
  const points = room.polygon.map(
    (point) => new THREE.Vector3(point.x - origin.x, 0.049, point.y - origin.y),
  );
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: "#2f8960",
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    }),
  );
  outline.renderOrder = 1000;
  group.add(outline);
  if (room.floor_enabled !== false) {
    const shape = new THREE.Shape(
      room.polygon.map(
        (point) => new THREE.Vector2(point.x - origin.x, -(point.y - origin.y)),
      ),
    );
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    const surface = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: "#79bb83",
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    surface.position.y = 0.043;
    surface.renderOrder = 10;
    group.add(surface);
  }
  rt.scene.add(group);
  rt.roomHighlight = group;
  rt.roomHighlightKey = key;
}
