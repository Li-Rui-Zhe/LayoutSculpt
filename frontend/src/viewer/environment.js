import * as THREE from "three";
import { presets } from "../catalog.js";

export function normalizeEnvironment(id) {
  if (id === "evening") return "sunset";
  return presets.some((p) => p.id === id) ? id : "midday";
}

export function environmentTarget(id, daylight = 74, showcase = false) {
  const preset = { ...presets.find((p) => p.id === normalizeEnvironment(id)) };
  // 样板间的窗向固定，日光从北侧窗进入；普通项目仍按通用环境照明。
  if (showcase && preset.id === "midday")
    Object.assign(preset, {
      position: [-6, 7.5, -3],
    });
  if (showcase && preset.id === "sunset")
    Object.assign(preset, {
      position: [-8, 4, -4],
      intensity: 2.6,
      color: "#ffd1a0",
    });
  const level = Math.min(
    100,
    Math.max(0, Number.isFinite(daylight) ? daylight : 74),
  );
  return {
    sun: preset.intensity * (0.45 + (level / 100) * 0.75),
    ambient: preset.ambient * (0.5 + level / 100),
    fill: preset.fill,
    exposure: preset.exposure,
    environment: preset.environment,
    ao: preset.ao,
    fixtures: preset.id === "night" ? 1 : 0,
    position: new THREE.Vector3(...preset.position).multiplyScalar(1.8),
    sunColor: new THREE.Color(preset.color),
    sky: new THREE.Color(preset.sky),
    bounce: new THREE.Color(preset.bounce),
    fillColor: new THREE.Color(preset.fillColor),
    background: new THREE.Color(preset.background),
    ground: new THREE.Color(preset.ground),
  };
}

export function blendEnvironment(from, to, fraction) {
  const t = Math.max(0, Math.min(1, fraction));
  if (t === 0) return from;
  if (t === 1) return to;
  const eased = t * t * (3 - 2 * t);
  return Object.fromEntries(
    Object.entries(to).map(([key, value]) => [
      key,
      typeof value === "number"
        ? THREE.MathUtils.lerp(from[key], value, eased)
        : from[key].clone().lerp(value, eased),
    ]),
  );
}

const referenceSkyColors = {
  midday: ["#c7deea", "#518fce"],
  sunset: ["#f1cfb0", "#7f9ac7"],
  night: ["#40546f", "#0e1935"],
};

// Shade only the empty background of an eye-level reference. Geometry and
// lighting still come from the scene, including the glazing and railings.
export function withReferenceSky(scene, camera, preset, render) {
  const [horizon, sky] = referenceSkyColors[normalizeEnvironment(preset)].map(
    (color) => new THREE.Color(color),
  );
  const rows = 128;
  const pixels = new Uint8Array(rows * 4);
  const rotation = camera.getWorldQuaternion(new THREE.Quaternion());
  const halfHeight =
    Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom;
  const ray = new THREE.Vector3();
  const color = new THREE.Color();
  for (let row = 0; row < rows; row++) {
    ray.set(0, ((2 * row) / (rows - 1) - 1) * halfHeight, -1);
    ray.applyQuaternion(rotation).normalize();
    const height = THREE.MathUtils.smoothstep(ray.y, -0.055, 0.38);
    color.copy(horizon).lerp(sky, height).convertLinearToSRGB();
    pixels.set([color.r * 255, color.g * 255, color.b * 255, 255], row * 4);
  }
  const background = new THREE.DataTexture(pixels, 1, rows);
  background.colorSpace = THREE.SRGBColorSpace;
  background.magFilter = THREE.LinearFilter;
  background.minFilter = THREE.LinearFilter;
  background.needsUpdate = true;
  const original = scene.background;
  scene.background = background;
  try {
    return render();
  } finally {
    scene.background = original;
    background.dispose();
  }
}
