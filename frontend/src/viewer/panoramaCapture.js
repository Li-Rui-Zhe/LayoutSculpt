import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildTour } from "./tourModel.js";
import { recommendedRooms } from "./RoomViews.js";
import { TourCeiling } from "./TourCeiling.js";
import { hidePlaceholderVisuals } from "./fixtureLights.js";

const width = 2048;
// 固定相机不需要步行碰撞余量，也能为狭小的玄关或卫生间取景。
const tourOptions = { minimumClearance: 0.12 };

// 同一眼点采集六个方向，再把立方体投影到整张经纬全景。
const projection = {
  vertexShader: `
    varying vec2 screenUv;
    void main() {
      screenUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    uniform samplerCube room;
    uniform float rotation;
    varying vec2 screenUv;
    void main() {
      float longitude = (screenUv.x - 0.5) * 6.28318530718 + rotation;
      float latitude = (screenUv.y - 0.5) * 3.14159265359;
      float horizontal = cos(latitude);
      vec3 direction = vec3(
        horizontal * cos(longitude), sin(latitude), horizontal * sin(longitude)
      );
      gl_FragColor = textureCube(room, direction);
      #include <colorspace_fragment>
    }
  `,
};

function relativeLongitude(longitude, rotation) {
  const offset = longitude - rotation;
  return Math.atan2(Math.sin(offset), Math.cos(offset));
}

// 优先把接缝放在连续的中性色区域。用低分辨率预渲染查找
// 横向色差和竖向边缘都较少的一段，避开窗框、家具轮廓与窗外天空。
function seamRotation(renderer, scene, camera) {
  const probeWidth = 360;
  const probeHeight = 180;
  renderer.setSize(probeWidth, probeHeight, false);
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const pixels = new Uint8Array(probeWidth * probeHeight * 4);
  gl.readPixels(
    0,
    0,
    probeWidth,
    probeHeight,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels,
  );
  const rowOffset = (x, y) =>
    4 * ((probeHeight - 1 - y) * probeWidth + ((x + probeWidth) % probeWidth));
  const colorDistance = (a, b) =>
    (Math.abs(pixels[a] - pixels[b]) +
      Math.abs(pixels[a + 1] - pixels[b + 1]) +
      Math.abs(pixels[a + 2] - pixels[b + 2])) /
    3;

  let best = Infinity;
  let boundary = 0;
  for (let x = 0; x < probeWidth; x++) {
    let cost = 0;
    for (let y = 52; y < 133; y += 2) {
      const current = rowOffset(x, y);
      const rgb = pixels.subarray(current, current + 3);
      const weight = y >= 67 && y <= 109 ? 2 : 1;
      cost += Math.max(...rgb) - Math.min(...rgb);
      for (const offset of [-10, -6, -3, 3, 6, 10])
        cost += weight * colorDistance(current, rowOffset(x + offset, y));
      if (y >= 60 && y <= 122)
        cost += 2 * colorDistance(current, rowOffset(x, y + 2));
    }
    if (cost < best) {
      best = cost;
      boundary = x;
    }
  }
  return (2 * Math.PI * (boundary + 0.5)) / probeWidth;
}

function landmarksFor(model, eye, room) {
  const groups = new Map();
  model.traverse((mesh) => {
    const {
      furniture_index: index,
      furniture_name: label,
      room_id,
    } = mesh.userData;
    if (
      !mesh.isMesh ||
      !mesh.visible ||
      index == null ||
      !label ||
      room_id !== room.id
    )
      return;
    const group = groups.get(index) || { label, bounds: new THREE.Box3() };
    group.bounds.expandByObject(mesh);
    groups.set(index, group);
  });
  return Array.from(groups.values(), ({ label, bounds }) => {
    const center = bounds.getCenter(new THREE.Vector3()).sub(eye);
    return {
      label: Array.from(label).slice(0, 80).join(""),
      yaw: Math.atan2(center.z, center.x),
    };
  }).slice(0, 32);
}

export function panoramaDoors(room, view, preferredHeading) {
  if (!room?.doors.length || !view) return [];
  let rotation =
    view.rotation == null ? null : THREE.MathUtils.degToRad(view.rotation);
  if (rotation == null && view.heading != null) {
    // 旧全景可用底图家具的实测方位恢复接缝角度。
    const matches = (view.landmarks || []).flatMap(({ label, x }) => {
      const target = room.landmarks.find((item) => item.label === label);
      return target ? [target.yaw - (x / 100 - 0.5) * 2 * Math.PI] : [];
    });
    rotation =
      matches.length && preferredHeading == null
        ? Math.atan2(
            matches.reduce((sum, yaw) => sum + Math.sin(yaw), 0),
            matches.reduce((sum, yaw) => sum + Math.cos(yaw), 0),
          )
        : (preferredHeading ?? 0) - THREE.MathUtils.degToRad(view.heading);
  }
  if (rotation == null) return [];
  return room.doors.map((door) => ({
    ...door,
    yaw: relativeLongitude(door.yaw, rotation),
  }));
}

function eyePoint(room) {
  const station = room.stations[0];
  return new THREE.Vector3(station.x, station.height, station.y);
}

function modelResources(model) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of [mesh.material].flat()) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material))
      if (value?.isTexture) textures.add(value);
  }
  return () => {
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
  };
}

export async function loadPanoramaProject(modelUrl) {
  const { scene: model } = await new GLTFLoader().loadAsync(modelUrl);
  const disposeModel = modelResources(model);
  let session;
  try {
    const { available, portals } = buildTour(model, tourOptions);
    const preferred = recommendedRooms(available)[0];
    const rooms = available
      .map((room) => {
        const eye = eyePoint(room);
        const doors = portals
          .filter((portal) => portal.rooms.includes(room.id))
          .map((portal) => {
            const destination = available.find(
              (item) => item.id !== room.id && portal.rooms.includes(item.id),
            );
            const x = portal.x - eye.x;
            const z = portal.y - eye.z;
            return {
              id: portal.id,
              roomId: destination.id,
              name: destination.name,
              yaw: Math.atan2(z, x),
              pitch: Math.atan2(portal.height + 0.25 - eye.y, Math.hypot(x, z)),
            };
          });
        return {
          id: room.id,
          name: room.name,
          doors,
          landmarks: landmarksFor(model, eye, room),
        };
      })
      .sort(
        (a, b) =>
          Number(b.id === preferred?.id) - Number(a.id === preferred?.id),
      );
    return {
      rooms,
      capture(id, heading) {
        if (session?.lost()) {
          session.dispose();
          session = null;
        }
        session ??= openPanoramaCapture(model.clone(true), available);
        return session.capture(id, heading);
      },
      dispose() {
        session?.dispose();
        disposeModel();
      },
    };
  } catch (error) {
    disposeModel();
    throw error;
  }
}

function openPanoramaCapture(model, rooms) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  let ceiling, target, quad, screen;
  const clay = new THREE.MeshStandardMaterial({
    color: "#e9e8e4",
    roughness: 1,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: "#f0f5f7",
    transparent: true,
    opacity: 0.12,
    roughness: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const floor = new THREE.MeshStandardMaterial({
    color: "#cfcfc9",
    roughness: 1,
  });
  const walls = new THREE.MeshStandardMaterial({
    color: "#f1f1ed",
    roughness: 1,
  });
  function dispose() {
    for (const material of [clay, glass, floor, walls]) material.dispose();
    ceiling?.dispose();
    target?.dispose();
    quad?.geometry.dispose();
    screen?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  try {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#c8d2dc");
    scene.add(model);
    ceiling = new TourCeiling(scene, model);
    ceiling.material.color.set("#eeeeea");
    hidePlaceholderVisuals(model);

    model.traverse((mesh) => {
      if (mesh.isLight) mesh.visible = false;
      if (!mesh.isMesh) return;
      const originals = [mesh.material].flat();
      mesh.material = originals.map((material) =>
        (mesh.userData.opening_glass ||
          mesh.userData.boundary_glass ||
          material.transparent) &&
        material.opacity < 0.85
          ? glass
          : mesh.userData.structure_kind === "room"
            ? floor
            : mesh.userData.wall_id
              ? walls
              : clay,
      );
      if (mesh.material.length === 1) mesh.material = mesh.material[0];
    });
    scene.add(new THREE.HemisphereLight("#ffffff", "#a3a3a0", 2.4));
    const key = new THREE.DirectionalLight("#ffffff", 1.2);
    key.position.set(-4, 7, 3);
    scene.add(key);
    target = new THREE.WebGLCubeRenderTarget(768, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    const camera = new THREE.CubeCamera(0.025, 100, target);

    screen = new THREE.ShaderMaterial({
      ...projection,
      uniforms: {
        room: { value: target.texture },
        rotation: { value: 0 },
      },
    });
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), screen);
    const output = new THREE.Scene();
    output.add(quad);
    const outputCamera = new THREE.Camera();
    function capture(roomId, preferredHeading) {
      const room = rooms.find((value) => value.id === roomId);
      if (!room) throw new Error("这个房间暂时没有可用的站位。");
      const eye = eyePoint(room);
      camera.position.copy(eye);
      camera.update(renderer, scene);
      screen.uniforms.rotation.value = 0;
      const rotation = seamRotation(renderer, output, outputCamera);
      screen.uniforms.rotation.value = rotation;
      renderer.setSize(width, width / 2, false);
      renderer.render(output, outputCamera);
      const image = renderer.domElement.toDataURL("image/jpeg", 0.94);
      if (!image.startsWith("data:image/jpeg;base64,"))
        throw new Error("白模全景导出失败。");
      const landmarks = landmarksFor(model, eye, room).map(
        ({ label, yaw }) => ({
          label,
          x: Math.round(
            (relativeLongitude(yaw, rotation) / (2 * Math.PI) + 0.5) * 100,
          ),
        }),
      );
      const focus = landmarks.find(({ label }) =>
        /床|沙发|餐桌|浴缸/.test(label),
      );
      const heading =
        preferredHeading == null && focus
          ? (focus.x / 100 - 0.5) * 360
          : THREE.MathUtils.radToDeg(
              relativeLongitude(preferredHeading ?? 0, rotation),
            );
      return {
        image,
        roomId: room.id,
        roomName: room.name,
        landmarks,
        heading,
        rotation: THREE.MathUtils.radToDeg(relativeLongitude(rotation, 0)),
      };
    }
    return {
      capture,
      lost: () => renderer.getContext().isContextLost(),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
