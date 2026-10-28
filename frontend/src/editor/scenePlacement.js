import * as THREE from "three";

export function architecturePointOnRay(ray, origin, walls, cutaway = false) {
  let nearest = null;
  for (const wall of walls || []) {
    if (wall.edit_hidden) continue;
    const a = new THREE.Vector3(
      wall.start.x - origin.x,
      0,
      wall.start.y - origin.y,
    );
    const direction = new THREE.Vector3(
      wall.end.x - wall.start.x,
      0,
      wall.end.y - wall.start.y,
    );
    const length = direction.length();
    if (length < 0.05) continue;
    direction.normalize();
    const normal = new THREE.Vector3(-direction.z, 0, direction.x);
    const hit = ray.intersectPlane(
      new THREE.Plane().setFromNormalAndCoplanarPoint(normal, a),
      new THREE.Vector3(),
    );
    const height = cutaway ? Math.min(1.2, wall.height) : wall.height;
    if (!hit || hit.y < 0 || hit.y > height + 0.05) continue;
    const along = hit.clone().sub(a).dot(direction);
    if (along < -0.06 || along > length + 0.06) continue;
    const distance = ray.origin.distanceToSquared(hit);
    if (!nearest || distance < nearest.distance)
      nearest = {
        distance,
        x: hit.x + origin.x,
        y: hit.z + origin.y,
        wallId: wall.id,
      };
  }
  return nearest;
}

// 放置是独立手势，不能穿透到选取、直接拖拽或 OrbitControls。
export function installFurniturePlacement({ element, rt, callbacks, rayAt }) {
  let down = null;
  const point = (event) => {
    if (!rt.liveOrigin) return null;
    const ray = rayAt(event);
    const placement = callbacks.current.placement;
    if (placement?.kind === "architecture" && placement.walls) {
      const hit = architecturePointOnRay(
        ray,
        rt.liveOrigin,
        placement.walls,
        callbacks.current.cutaway,
      );
      if (hit) return hit;
    }
    const hit = ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      new THREE.Vector3(),
    );
    return hit
      ? { x: hit.x + rt.liveOrigin.x, y: hit.z + rt.liveOrigin.y }
      : null;
  };
  const stop = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const start = (e) => {
    if (!callbacks.current.placement || e.button !== 0) return;
    stop(e);
    down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    element.setPointerCapture(e.pointerId);
    const p = point(e);
    if (p) callbacks.current.onPlacementMove?.(p);
  };
  const move = (e) => {
    if (!callbacks.current.placement || (e.buttons && !down)) return;
    const p = point(e);
    if (p) callbacks.current.onPlacementMove?.(p);
    if (down) stop(e);
  };
  const release = () => {
    const previous = down;
    down = null;
    if (previous && element.hasPointerCapture(previous.id))
      element.releasePointerCapture(previous.id);
    return previous;
  };
  const end = (e) => {
    if (!down || e.pointerId !== down.id) return;
    stop(e);
    const previous = release();
    const rect = element.getBoundingClientRect();
    if (
      !callbacks.current.placement ||
      Math.hypot(e.clientX - previous.x, e.clientY - previous.y) > 5 ||
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    )
      return;
    const p = point(e);
    if (p) callbacks.current.onPlacementConfirm?.(p);
  };
  const cancel = () => release();
  const events = {
    pointerdown: start,
    pointermove: move,
    pointerup: end,
    pointercancel: cancel,
    lostpointercapture: cancel,
  };
  Object.entries(events).forEach(([name, fn]) =>
    element.addEventListener(name, fn, true),
  );
  return () => {
    Object.entries(events).forEach(([name, fn]) =>
      element.removeEventListener(name, fn, true),
    );
    release();
  };
}
