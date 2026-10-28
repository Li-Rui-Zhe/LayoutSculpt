import * as THREE from "three";
import { planOrigin, liveKey } from "./liveModel.js";
import { updateCutaway } from "../viewer/cutaway.js";
import { updateFixtureLights } from "../viewer/fixtureLights.js";
import { isGlassBoundary, boundaryFrameParts } from "./balcony.js";
import { openingParts } from "./openingVisuals.js";
import { liveSceneSnapshot, liveCapabilities } from "./liveSceneUpdates.js";
import { previewKey } from "./previewIdentity.js";

// 地板饰面等待精细模型原子替换；不为换色临时重建整屋建筑。
function geometrySignature(layout) {
  return previewKey({
    ...layout,
    rooms: layout.rooms.map((room) =>
      Object.fromEntries(
        Object.entries(room).filter(
          ([key]) => !key.startsWith("floor_") || key === "floor_enabled",
        ),
      ),
    ),
  });
}

// 拖动结构时用同一份草稿直接更新可见几何；停手后由正式建模器替换精细材质与连接面。
export function updateLiveArchitecture(rt, document, cutaway, night) {
  const model = rt.group.children[0];
  if (!model || !rt.modelDocument) return;
  const signature = geometrySignature(document.layout);
  const base = geometrySignature(liveSceneSnapshot(rt.modelDocument, document, liveCapabilities(rt)).layout);
  const key = signature === base ? null : signature + cutaway + night;
  if (rt.architectureKey === key) return;
  rt.architectureKey = key;
  if (rt.architectureOverlay) {
    rt.architectureOverlay.traverse((o) => {
      o.geometry?.dispose();
      if (o.material && o.userData.liveOwnMaterial) o.material.dispose();
    });
    rt.architectureOverlay.userData.fallback?.dispose();
    model.remove(rt.architectureOverlay);
    rt.architectureOverlay = null;
    for (const [node, visible] of rt.architectureHidden || [])
      node.visible = visible;
    rt.architectureHidden = [];
    updateCutaway(model, null, { enabled: cutaway });
    updateFixtureLights(model, night);
  }
  if (!key) return;
  const origin = planOrigin(rt.modelDocument),
    overlay = new THREE.Group(),
    hidden = [],
    palette = {},
    roomMaterials = new Map();
  model.traverse((node) => {
    const data = node.userData;
    if (node.isMesh && !data.editor_proxy) {
      const roomId =
        data.floor_room_id || (data.structure_kind === "room" && data.room_id);
      if (roomId) roomMaterials.set(roomId, node.material);
      if (data.structure_kind === "outline") palette.outline ||= node.material;
    }
    if (node.isMesh && !data.editor_proxy && data.surface_category)
      palette[data.surface_category] ||= node.material;
    if (
      node.isMesh &&
      !data.editor_proxy &&
      data.room_id &&
      data.furniture_index == null
    )
      palette.floor ||= node.material;
    if (
      node.isMesh &&
      !data.editor_proxy &&
      !data.boundary_glass &&
      (data.wall_id || data.wall_ids)
    )
      palette.wall ||= node.material;
    if (data.furniture_index != null || data.liveFurniture) return;
    if (node.isMesh || node.isLight) {
      // 家具网格保持实时变换；其余建筑与灯光全部由草稿几何显示。
      let parent = node,
        furniture = false;
      while (parent && parent !== model) {
        if (
          parent.userData.liveFurniture ||
          parent.userData.furniture_index != null
        )
          furniture = true;
        parent = parent.parent;
      }
      if (!furniture) {
        hidden.push([node, node.visible]);
        node.visible = false;
      }
    }
  });
  const fallback = new THREE.MeshStandardMaterial({
    color: "#e7e2d8",
    roughness: 0.85,
  });
  const add = (geometry, material, position, rotation, data, own = false) => {
    const mesh = new THREE.Mesh(geometry, material || fallback);
    mesh.position.copy(position);
    mesh.rotation.y = rotation || 0;
    mesh.userData = { ...data, liveOwnMaterial: own };
    overlay.add(mesh);
    return mesh;
  };
  const slab = (points, y, material, data) => {
    const shape = new THREE.Shape(
      points.map((p) => new THREE.Vector2(p.x - origin.x, -(p.y - origin.y))),
    );
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    add(geometry, material, new THREE.Vector3(0, y, 0), 0, data);
  };
  slab(document.layout.outline, -0.02, palette.outline || palette.floor, {
    structure_kind: "outline",
  });
  document.layout.rooms.forEach((room) => {
    if (room.floor_enabled !== false && !room.edit_hidden)
      slab(room.polygon, 0.028, roomMaterials.get(room.id), {
        room_id: room.id,
        live_selection: {
          type: "rooms",
          key: liveKey(room, document.layout.rooms.indexOf(room)),
        },
      });
  });
  for (const wall of document.layout.walls) {
    if (wall.edit_hidden) continue;
    const dx = wall.end.x - wall.start.x,
      dy = wall.end.y - wall.start.y,
      length = Math.hypot(dx, dy);
    if (length < 0.001) continue;
    const angle = -Math.atan2(dy, dx),
      height = cutaway ? Math.min(1.2, wall.height) : wall.height;
    const openings = document.layout.openings
      .map((o, index) => ({ ...o, index }))
      .filter((o) => o.wall_id === wall.id);
    const cuts = [
      0,
      length,
      ...openings.flatMap((o) => [
        Math.max(0, o.offset),
        Math.min(length, o.offset + o.width),
      ]),
    ].sort((a, b) => a - b);
    const box = (
      start,
      end,
      bottom,
      top,
      thickness,
      material,
      data,
      own = false,
    ) => {
      if (end - start < 0.001 || top - bottom < 0.001) return;
      const at = (start + end) / 2 / length;
      add(
        new THREE.BoxGeometry(end - start, top - bottom, thickness),
        material,
        new THREE.Vector3(
          wall.start.x + dx * at - origin.x,
          (bottom + top) / 2,
          wall.start.y + dy * at - origin.y,
        ),
        angle,
        data,
        own,
      );
    };
    const glass = isGlassBoundary(wall);
    const glassMaterial = glass
      ? new THREE.MeshStandardMaterial({
          color: "#b7dbdf",
          transparent: true,
          opacity: 48 / 255,
          roughness: 0.12,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      : null;
    const wallBox = (start, end, bottom, top, thickness, material, data) => {
      if (!glass)
        return box(start, end, bottom, top, thickness, material, data);
      const sill = wall.sill_height || 0;
      box(start, end, bottom, Math.min(top, sill), thickness, material, data);
      box(
        start,
        end,
        Math.max(bottom, sill),
        top,
        thickness,
        glassMaterial,
        data,
        true,
      );
    };
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1],
        b = cuts[i],
        mid = (a + b) / 2,
        opening = openings.find(
          (o) => mid > o.offset && mid < o.offset + o.width,
        );
      if (!opening)
        wallBox(a, b, 0, height, wall.thickness, palette.wall, {
          wall_id: wall.id,
          live_selection: {
            type: "walls",
            key: liveKey(wall, document.layout.walls.indexOf(wall)),
          },
        });
      else {
        wallBox(
          a,
          b,
          0,
          Math.min(opening.bottom, height),
          wall.thickness,
          palette.wall,
          {
            wall_id: wall.id,
            live_selection: {
              type: "walls",
              key: liveKey(wall, document.layout.walls.indexOf(wall)),
            },
          },
        );
        wallBox(
          a,
          b,
          opening.bottom + opening.height,
          height,
          wall.thickness,
          palette.wall,
          {
            wall_id: wall.id,
            live_selection: {
              type: "walls",
              key: liveKey(wall, document.layout.walls.indexOf(wall)),
            },
          },
        );
      }
    }
    if (glass) {
      const frameMaterial = new THREE.MeshStandardMaterial({
        color: "#6b7271",
        metalness: 0.78,
        roughness: 0.25,
      });
      for (const [a, b, low, high] of boundaryFrameParts(wall, openings)) {
        box(
          a,
          b,
          low,
          Math.min(high, height),
          wall.thickness + 0.008,
          frameMaterial,
          {
            wall_id: wall.id,
            live_selection: {
              type: "walls",
              key: liveKey(wall, document.layout.walls.indexOf(wall)),
            },
          },
          true,
        );
      }
    }
    for (const o of openings) {
      const partMaterials = {};
      for (const part of openingParts(o, wall.thickness)) {
        const low = part.position[1] - part.size[1] / 2;
        const high = Math.min(
          part.position[1] + part.size[1] / 2,
          cutaway ? 1.2 : wall.height,
        );
        if (high - low < 0.001) continue;
        const type = part.material;
        partMaterials[type] ||= new THREE.MeshStandardMaterial({
          color: {
            frame: "#e2e2da",
            wood: "#a98b62",
            glass: "#b7dbdf",
            frosted: "#d7e5e5",
            metal: "#6b726c",
          }[type],
          transparent: type === "glass" || type === "frosted",
          opacity: type === "glass" ? 0.22 : type === "frosted" ? 0.65 : 1,
          roughness: type === "glass" ? 0.12 : 0.65,
          depthWrite: !["glass", "frosted"].includes(type),
          side: THREE.DoubleSide,
        });
        const at = o.offset + part.position[0],
          depth = part.position[2];
        add(
          new THREE.BoxGeometry(part.size[0], high - low, part.size[2]),
          partMaterials[type],
          new THREE.Vector3(
            wall.start.x +
              (dx * at) / length -
              (dy * depth) / length -
              origin.x,
            (low + high) / 2,
            wall.start.y +
              (dy * at) / length +
              (dx * depth) / length -
              origin.y,
          ),
          angle + part.angle,
          {
            opening_index: o.index,
            wall_id: wall.id,
            live_selection: { type: "openings", key: liveKey(o, o.index) },
          },
          true,
        );
      }
      // 门、窗、通道都有独立可点选的体积，透明区域不会伪装成实体墙。
      const material = new THREE.MeshStandardMaterial({
        color:
          o.kind === "window"
            ? "#9cd8e6"
            : o.kind === "door"
              ? "#b99870"
              : "#57ae8f",
        transparent: true,
        opacity: o.kind === "passage" ? 0.12 : 0.025,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      box(
        o.offset,
        o.offset + o.width,
        o.bottom,
        Math.min(o.bottom + o.height, cutaway ? 1.2 : wall.height),
        Math.max(0.04, wall.thickness * 0.4),
        material,
        {
          opening_index: o.index,
          wall_id: wall.id,
          live_selection: { type: "openings", key: liveKey(o, o.index) },
        },
        true,
      );
    }
  }
  for (const light of document.layout.lights || []) {
    if (light.edit_hidden) continue;
    const color = new THREE.Color(
      { 2700: "#ffd6a3", 3000: "#ffe0b5", 4000: "#fff0d8", 6500: "#e2edff" }[
        light.temperature
      ],
    );
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: night && light.enabled ? 1 : 0,
    });
    const p = new THREE.Vector3(
      light.x - origin.x,
      light.elevation,
      light.y - origin.y,
    );
    add(
      new THREE.SphereGeometry(0.1, 12, 8),
      material,
      p,
      0,
      {
        fixture_id: light.id,
        live_selection: {
          type: "lights",
          key: liveKey(light, document.layout.lights.indexOf(light)),
        },
      },
      true,
    );
    if (night && light.enabled) {
      const source = new THREE.PointLight(
        color,
        (light.lumens / (4 * Math.PI)) * 0.55,
        15,
        2,
      );
      source.position.copy(p);
      overlay.add(source);
    }
  }
  overlay.userData.fallback = fallback;
  model.add(overlay);
  rt.architectureHidden = hidden;
  rt.architectureOverlay = overlay;
}

export function clearLiveArchitecture(rt) {
  if (rt.architectureOverlay) {
    rt.architectureOverlay.userData.fallback?.dispose();
    rt.architectureOverlay = null;
  }
  rt.architectureHidden = [];
  rt.architectureKey = undefined;
}
