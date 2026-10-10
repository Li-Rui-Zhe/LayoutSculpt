import * as THREE from "three";
export function prepareIsolationMaterials(root) {
  const clones = new Map(),
    replaced = new Set();
  root.traverse((o) => {
    const d = o.userData;
    if (
      !o.isMesh ||
      d.furniture_index != null ||
      d.asset_id ||
      d.diy_part_id ||
      d.fixture_id
    )
      return;
    if (!(
      d.wall_id ||
      d.wall_ids ||
      d.architecture_network ||
      d.cutaway_full ||
      d.cutaway_only ||
      d.cutaway_upper ||
      /墙|窗|门框|踢脚/.test(o.name)
    ))
      return;
    const values = [o.material].flat().map((m) => {
      if (!clones.has(m)) {
        const clone = m.clone();
        clone.userData.roomIsolationMargin = 0.35;
        clones.set(m, clone);
        replaced.add(m);
      }
      return clones.get(m);
    });
    o.material = Array.isArray(o.material) ? values : values[0];
  });
  root.traverse((o) => {
    if (o.isMesh) for (const m of [o.material].flat()) replaced.delete(m);
  });
  replaced.forEach((m) => m.dispose());
}
function refreshShadowShaders(scene) {
  (scene.scene || scene.model)?.traverse((o) => {
    for (const material of [o.material].flat().filter(Boolean))
      material.needsUpdate = true;
  });
}

// Recover the actual top-face boundary, including concave rooms, from old GLBs.
export function floorBoundary(mesh) {
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry,
    position = geometry.attributes.position,
    index = geometry.index;
  const vertices = Array.from({ length: position.count }, (_, i) =>
    new THREE.Vector3()
      .fromBufferAttribute(position, i)
      .applyMatrix4(mesh.matrixWorld),
  );
  const top = Math.max(...vertices.map((p) => p.y)),
    edges = new Map(),
    points = new Map();
  const key = (p) => `${p.x.toFixed(5)},${p.z.toFixed(5)}`;
  const count = index?.count || position.count;
  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map(
      (k) => vertices[index ? index.getX(i + k) : i + k],
    );
    if (triangle.some((p) => Math.abs(p.y - top) > 0.0001)) continue;
    for (let j = 0; j < 3; j++) {
      const a = triangle[j],
        b = triangle[(j + 1) % 3],
        ka = key(a),
        kb = key(b);
      if (ka === kb) continue;
      points.set(ka, a);
      points.set(kb, b);
      const edge = [ka, kb].sort().join("|");
      const existing = edges.get(edge);
      edges.set(
        edge,
        existing
          ? { ...existing, count: existing.count + 1 }
          : { a: ka, b: kb, count: 1 },
      );
    }
  }
  const boundary = [...edges.values()].filter((e) => e.count === 1);
  if (!boundary.length) return [];
  const links = new Map();
  for (const { a, b } of boundary) {
    if (!links.has(a)) links.set(a, []);
    if (!links.has(b)) links.set(b, []);
    links.get(a).push(b);
    links.get(b).push(a);
  }
  const result = [],
    start = boundary[0].a;
  let current = start,
    previous = null;
  do {
    result.push(
      new THREE.Vector2(points.get(current).x, points.get(current).z),
    );
    const next = links.get(current)?.find((k) => k !== previous);
    previous = current;
    current = next;
  } while (current && current !== start && result.length <= 256);
  return current === start ? result : [];
}

export function setRoomIsolation(scene, id) {
  const root = scene.model;
  if (!root) return false;
  let state = root.userData.roomIsolation;
  if (!id) {
    if (state) {
      state.enabled.value = 0;
      if (state.renderRestore) {
        if (scene.ao) scene.ao.enabled = state.renderRestore.ao;
        if (scene.renderer)
          scene.renderer.shadowMap.enabled = state.renderRestore.shadows;
        refreshShadowShaders(scene);
        state.renderRestore = null;
      }
    }
    scene.dirty = true;
    return true;
  }
  let polygon = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (
      !polygon.length &&
      o.isMesh &&
      o.userData.structure_kind === "room" &&
      o.userData.room_id === id
    )
      polygon = floorBoundary(o);
  });
  if (polygon.length < 3 || polygon.length > 128) return false;
  if (!state) {
    state = {
      enabled: { value: 0 },
      count: { value: 0 },
      points: { value: Array.from({ length: 128 }, () => new THREE.Vector2()) },
    };
    root.userData.roomIsolation = state;
    const materials = new Set();
    root.traverse((o) => {
      if (o.isMesh) for (const m of [o.material].flat()) materials.add(m);
    });
    for (const material of materials) {
      const previous = material.onBeforeCompile,
        previousKey = material.customProgramCacheKey?.bind(material);
      const baseKey = previousKey?.() || "";
      material.onBeforeCompile = (shader, renderer) => {
        previous?.call(material, shader, renderer);
        Object.assign(shader.uniforms, {
          layoutRoomEnabled: state.enabled,
          layoutRoomCount: state.count,
          layoutRoomPoints: state.points,
          layoutRoomMargin: {
            value: material.userData.roomIsolationMargin || 0.005,
          },
        });
        shader.vertexShader =
          `varying vec2 layoutRoomPosition;\n${shader.vertexShader}`.replace(
            "#include <project_vertex>",
            "layoutRoomPosition = (modelMatrix * vec4(transformed, 1.0)).xz;\n#include <project_vertex>",
          );
        shader.fragmentShader =
          "uniform float layoutRoomMargin;\n" +
          `varying vec2 layoutRoomPosition;\nuniform float layoutRoomEnabled;\nuniform int layoutRoomCount;\nuniform vec2 layoutRoomPoints[128];\n${shader.fragmentShader}`.replace(
            "#include <clipping_planes_fragment>",
            `#include <clipping_planes_fragment>
          if(layoutRoomEnabled>0.5) {
            bool roomInside=false;
            vec2 roomA=layoutRoomPoints[layoutRoomCount-1];
            float roomEdge=10000.0;
            for(int roomIndex=0;roomIndex<128;roomIndex++) {
              if(roomIndex>=layoutRoomCount)break;
              vec2 roomB=layoutRoomPoints[roomIndex];
              vec2 edge=roomB-roomA;
              float t=clamp(dot(layoutRoomPosition-roomA,edge)/max(dot(edge,edge),0.000001),0.0,1.0);
              roomEdge=min(roomEdge,distance(layoutRoomPosition,roomA+t*edge));
              if((roomA.y>layoutRoomPosition.y)!=(roomB.y>layoutRoomPosition.y)) {
                if(layoutRoomPosition.x<(roomB.x-roomA.x)*(layoutRoomPosition.y-roomA.y)/(roomB.y-roomA.y)+roomA.x)roomInside=!roomInside;
              }
              roomA=roomB;
            }
            if(!roomInside && roomEdge>layoutRoomMargin)discard;
          }`,
          );
      };
      material.customProgramCacheKey = () => `${baseKey}:room-isolation-v1`;
      material.needsUpdate = true;
    }
  }
  if (!state.renderRestore)
    state.renderRestore = {
      ao: scene.ao?.enabled,
      shadows: scene.renderer?.shadowMap.enabled,
    };
  // Post-process depth and shadow passes do not use the colour shader's mask.
  // Disable those passes for the isolated inspection so removed rooms leave no ghosts.
  if (scene.ao) scene.ao.enabled = false;
  if (scene.renderer) scene.renderer.shadowMap.enabled = false;
  refreshShadowShaders(scene);
  polygon.forEach((p, i) => state.points.value[i].copy(p));
  state.count.value = polygon.length;
  state.enabled.value = 1;
  scene.dirty = true;
  return true;
}
