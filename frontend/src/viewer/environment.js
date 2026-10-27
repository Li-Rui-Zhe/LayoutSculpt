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
      position: [-3.8, 8, -5.5],
      intensity: 3.2,
      ambient: 0.82,
      fill: 0.6,
      color: "#ffe8c7",
      background: "#e9e7e0",
      ground: "#e9e7e0",
      ao: 0.58,
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
