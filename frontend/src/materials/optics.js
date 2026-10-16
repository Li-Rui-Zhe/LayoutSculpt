import * as THREE from "three";

export function opticalProfile(value) {
  return {
    transmission: value?.transmission ?? 0,
    metalness: value?.metalness ?? 0,
    ior: value?.ior ?? 1.5,
    thickness: value?.thickness ?? 0.01,
  };
}
export function applyOptics(material, value) {
  const optics = opticalProfile(value);
  material.metalness = optics.metalness;
  if (material.isMeshPhysicalMaterial) {
    material.transmission = optics.transmission;
    material.ior = optics.ior;
    material.thickness = optics.thickness;
  }
  material.needsUpdate = true;
}
// 允许原有普通墙地面切换成玻璃，并保留共享材质及原始贴图。
export function upgradeSurfaceMaterials(model) {
  const replacements = new Map();
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const replace = (material) => {
      const category = material.userData.surface_category;
      if (
        material.isMeshPhysicalMaterial ||
        !material.isMeshStandardMaterial ||
        !(
          category === "walls" ||
          category === "floor" ||
          /^(墙面|地板)/.test(material.name)
        )
      )
        return material;
      if (!replacements.has(material)) {
        const physical = new THREE.MeshPhysicalMaterial();
        THREE.MeshStandardMaterial.prototype.copy.call(physical, material);
        physical.defines = { ...physical.defines, PHYSICAL: "" };
        replacements.set(material, physical);
      }
      return replacements.get(material);
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(replace)
      : replace(mesh.material);
  });
  for (const material of replacements.keys()) material.dispose();
}
