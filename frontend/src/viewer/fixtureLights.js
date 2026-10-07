import * as THREE from "three";
const colors = {
  2700: "#ffd6a3",
  3000: "#ffe0b5",
  4000: "#fff0d8",
  6500: "#e2edff",
};
// Calibrate saved lumens for the real-time preview; keep brightness linear so
// the editor's intensity and on/off controls retain their meaning.
const previewIntensity = 0.55;
const sampleFixtures = [
  { name: "床头灯罩", id: "sample_bedside_left", lumens: 350 },
  { name: "床头灯罩.001", id: "sample_bedside_right", lumens: 350 },
  { name: "落地灯灯罩", id: "sample_floor_lamp", lumens: 650 },
];

function hidePlaceholderVisuals(model, markers) {
  const legacyKinds = new Set(
    markers
      .filter(
        ({ marker, data }) =>
          data.fixture_visual_placeholder !== false &&
          (data.fixture_kind === "bulb" ||
            (data.fixture_kind === "pendant" &&
              marker.name.startsWith("灯泡_"))),
      )
      .map(({ data }) => data.fixture_kind),
  );
  let hidden = 0;
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    const data = obj.userData;
    const placeholder =
      data.fixture_visual_placeholder ??
      ((data.fixture_id &&
        (data.fixture_kind === "bulb" ||
          (data.fixture_kind === "pendant" && obj.name.startsWith("灯泡_")))) ||
        (legacyKinds.has("bulb") && obj.name.startsWith("灯泡底座_")) ||
        (legacyKinds.has("pendant") && /^(吊灯灯座|吊灯吊线)_/.test(obj.name)));
    if (!placeholder) return;
    obj.visible = false;
    obj.castShadow = false;
    hidden++;
  });
  model.userData.hiddenFixtureVisualCount = hidden;
}

export function installFixtureLights(model, { sample = false } = {}) {
  if (model.userData.designLights) return;
  const markers = [];
  model.traverse((obj) => {
    if (obj.userData.fixture_id)
      markers.push({ marker: obj, data: obj.userData });
  });
  if (sample && markers.length === 0) {
    for (const fixture of sampleFixtures) {
      const marker =
        model.getObjectByName(fixture.name) ||
        model.getObjectByName(
          THREE.PropertyBinding.sanitizeNodeName(fixture.name),
        );
      if (!marker) continue;
      const color = colors[3000];
      marker.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.material = [obj.material].flat().map((material) => {
          const shade = material.clone();
          shade.emissive?.set(color);
          shade.emissiveIntensity = 0;
          return shade;
        });
        if (obj.material.length === 1) obj.material = obj.material[0];
      });
      markers.push({
        marker,
        data: {
          fixture_id: fixture.id,
          fixture_lumens: fixture.lumens,
          fixture_temperature: 3000,
          fixture_enabled: true,
        },
      });
    }
  }
  model.updateMatrixWorld(true);
  model.userData.designLights = markers.map(({ marker, data }) => {
    const LightType =
      data.fixture_kind === "pendant" ? THREE.SpotLight : THREE.PointLight;
    const light = new LightType(
      colors[data.fixture_temperature] || colors[3000],
      0,
      0,
      2,
    );
    light.name = `人工设计光源_${data.fixture_id}`;
    light.position.copy(
      model.worldToLocal(marker.getWorldPosition(new THREE.Vector3())),
    );
    if (light.isSpotLight) {
      light.angle = Math.PI * 0.38;
      light.penumbra = 1;
      light.decay = 2;
      light.target.position
        .copy(light.position)
        .add(new THREE.Vector3(0, -1, 0));
      model.add(light.target);
    }
    light.castShadow = data.fixture_cast_shadow !== false;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.radius = light.isSpotLight ? 5 : 7;
    light.shadow.bias = -0.001;
    light.shadow.normalBias = 0.035;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 30;
    const materials = [],
      surfaces = [];
    marker.traverse((obj) => {
      if (obj.isMesh) {
        surfaces.push(obj);
        obj.castShadow = false;
        for (const m of [obj.material].flat())
          if (m.emissive) materials.push(m);
      }
    });
    model.add(light);
    return {
      light,
      materials,
      surfaces,
      enabled: data.fixture_enabled !== false,
      lumens: Number(data.fixture_lumens) || 0,
    };
  });
  // Lights are siblings of their geometry. Hiding a placeholder never hides
  // its illumination or removes its editable source record.
  hidePlaceholderVisuals(model, markers);
}

export function updateFixtureLights(model, night) {
  for (const fixture of model?.userData.designLights || []) {
    const enabled = night && fixture.enabled && fixture.lumens > 0;
    fixture.light.intensity = enabled
      ? (fixture.lumens / (4 * Math.PI)) * previewIntensity
      : 0;
    fixture.light.visible = enabled;
    for (const material of fixture.materials)
      material.emissiveIntensity = enabled ? 2 : 0;
  }
}
