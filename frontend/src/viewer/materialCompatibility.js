// 旧版内置乳胶漆 GLB 漏写 metallicFactor；glTF 的缺省值是 1（金属）。
// 仅修复这四款已知涂料，不改动用户金属墙面、家具或自定义材质。
export function repairLegacyWallMaterials(model) {
  const visited = new Set();
  model.traverse((node) => {
    for (const material of [node.material].flat().filter(Boolean)) {
      if (visited.has(material)) continue;
      visited.add(material);
      if (
        /^墙面_微调_(white|cream|sage|gray)$/.test(material.name) &&
        material.metalness === 1
      ) {
        material.metalness = 0;
        material.needsUpdate = true;
      }
    }
  });
}
