import * as THREE from "three";
const colors = {
  2700: "#ffba70",
  3000: "#ffd091",
  4000: "#ffe4bb",
  6500: "#e3f0ff",
};

export function installFixtureLights(model) {
  if (model.userData.designLights) return;
  const markers = [];
  model.traverse((obj) => {
    if (obj.userData.fixture_id) markers.push(obj);
  });
  model.updateMatrixWorld(true);
  model.userData.designLights = markers.map((marker) => {
    const data = marker.userData;
    const light = new THREE.PointLight(
      colors[data.fixture_temperature] || colors[3000],
      0,
      0,
      2,
    );
    light.name = `人工设计光源_${data.fixture_id}`;
    light.position.copy(
      model.worldToLocal(marker.getWorldPosition(new THREE.Vector3())),
    );
    light.castShadow = true;
    light.shadow.mapSize.set(256, 256);
    light.shadow.bias = -0.001;
    light.shadow.normalBias = 0.035;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 50;
    const materials = [];
    marker.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = false;
        for (const m of [obj.material].flat())
          if (m.emissive) materials.push(m);
      }
    });
    model.add(light);
    return {
      light,
      materials,
      enabled: data.fixture_enabled !== false,
      lumens: Number(data.fixture_lumens) || 0,
    };
  });
}

export function updateFixtureLights(model, night) {
  for (const fixture of model?.userData.designLights || []) {
    const enabled = night && fixture.enabled && fixture.lumens > 0;
    fixture.light.intensity = enabled ? fixture.lumens / (4 * Math.PI) : 0;
    fixture.light.visible = enabled;
    for (const material of fixture.materials)
      material.emissiveIntensity = enabled ? 2 : 0;
  }
}
