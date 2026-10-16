export function surfaceProfile(material, category, role = "upholstery") {
  if (category === "fabric" && material.scheme) {
    if (role === "keep") return null;
    return material.scheme[role] || material.scheme.upholstery;
  }
  const surface =
    material.surface ||
    (category === "fabric"
      ? "linen"
      : { wood: "planks", stone: "stone", linen: "linen" }[material.texture] ||
        null);
  return {
    color: material.color,
    surface,
    roughness:
      material.roughness ??
      { linen: 0.94, planks: 0.44, stone: 0.62 }[surface] ??
      0.8,
    normalStrength:
      material.normalStrength ?? (surface === "linen" ? 0.35 : 0.25),
    optics: material.optics ?? null,
  };
}

export function softRole(name) {
  if (/画|艺术|色块|paper|artwork|painting/i.test(name)) return "keep";
  if (/窗帘|纱帘|curtain|drape/i.test(name)) return "curtain";
  if (/地毯|脚垫|rug|carpet/i.test(name)) return "rug";
  if (/靠枕|抱枕|搭毯|针织毯|配色|accent|cushion|throw/i.test(name))
    return "accent";
  if (/床|枕头|床品|被|bed|duvet|pillow/i.test(name)) return "bedding";
  return "upholstery";
}

// A sofa and a curtain may share one GLTF material. Split by use before recoloring.
export function isolateSoftSurfaces(model) {
  if (model.userData.softSurfacesIsolated) return;
  const clones = new Map(),
    replaced = new Set();
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    const list = [obj.material].flat().map((material) => {
      if (
        material.userData.surface_category !== "fabric" &&
        !material.name.startsWith("软装")
      )
        return material;
      const role = softRole(`${obj.name} ${obj.userData.furniture_name || ""}`);
      const key = `${material.uuid}:${role}`;
      if (!clones.has(key)) {
        const clone = material.clone();
        clone.userData.surface_category = "fabric";
        clone.userData.soft_role = role;
        clones.set(key, clone);
      }
      replaced.add(material);
      return clones.get(key);
    });
    obj.material = Array.isArray(obj.material) ? list : list[0];
  });
  model.traverse((obj) => {
    if (obj.isMesh) [obj.material].flat().forEach((m) => replaced.delete(m));
  });
  replaced.forEach((m) => m.dispose());
  model.userData.softSurfacesIsolated = true;
}
