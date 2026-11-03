import * as THREE from "three";

// 鸟瞰模型通常没有顶面。漫游时按真实地面三角形补齐室内遮挡，
// 保留凹轮廓与孔洞；不写入原模型，不改变灯光与导航。
const outdoor =
  /阳台|露台|庭院|天井|花园|室外|balcony|terrace|courtyard|patio|garden|deck|atrium/i;

export class TourCeiling {
  constructor(scene, model) {
    this.root = new THREE.Group();
    this.root.name = "漫游室内顶面（仅展示）";
    this.material = new THREE.MeshStandardMaterial({
      color: "#eeede7",
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    model.updateMatrixWorld(true);
    const floors = [],
      walls = [],
      existing = new Set();
    model.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes.position) return;
      const d = o.userData;
      if (d.structure_kind === "ceiling") existing.add(d.room_id);
      if (d.structure_kind === "room") floors.push(o);
      if (
        (d.wall_id || d.architecture_network) &&
        !d.opening_kind &&
        d.furniture_index == null &&
        !d.fixture_id &&
        !d.asset_id
      ) {
        const box = new THREE.Box3().setFromObject(o);
        walls.push(box);
      }
    });
    for (const floor of floors) {
      const d = floor.userData;
      if (
        existing.has(d.room_id) ||
        d.outdoor === true ||
        outdoor.test(
          [d.room_id, d.room_name, d.room_type, floor.name].join(" "),
        )
      )
        continue;
      const box = new THREE.Box3().setFromObject(floor);
      // 只采用有实际墙高依据的房间；矮栏杆不作为室内顶面高度。
      const heights = walls
        .filter(
          (w) =>
            w.max.y - box.max.y >= 1.95 &&
            w.max.y - box.max.y <= 6 &&
            w.min.y <= box.max.y + 0.3 &&
            w.max.x >= box.min.x - 0.3 &&
            w.min.x <= box.max.x + 0.3 &&
            w.max.z >= box.min.z - 0.3 &&
            w.min.z <= box.max.z + 0.3,
        )
        .map((w) => w.max.y)
        .sort((a, b) => a - b);
      if (!heights.length) continue;
      const height = heights[Math.floor(heights.length / 2)];
      const { position } = floor.geometry.attributes;
      const index = floor.geometry.index;
      const points = Array.from({ length: position.count }, (_, i) =>
        new THREE.Vector3()
          .fromBufferAttribute(position, i)
          .applyMatrix4(floor.matrixWorld),
      );
      const vertices = [];
      for (let i = 0; i < (index?.count ?? position.count); i += 3) {
        const triangle = [0, 1, 2].map(
          (k) => points[index ? index.getX(i + k) : i + k],
        );
        if (triangle.some((p) => Math.abs(p.y - box.max.y) > 0.0001)) continue;
        // 朝室内的法线；保留原三角剖分，不用包围盒封住露台或中庭。
        const normal = new THREE.Vector3().crossVectors(
          triangle[1].clone().sub(triangle[0]),
          triangle[2].clone().sub(triangle[0]),
        );
        if (normal.y > 0) triangle.reverse();
        for (const p of triangle) vertices.push(p.x, height - 0.005, p.z);
      }
      if (!vertices.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      geometry.computeVertexNormals();
      const ceiling = new THREE.Mesh(geometry, this.material);
      ceiling.name = `漫游顶面_${d.room_name || d.room_id}`;
      ceiling.userData = { presentationOnly: true, room_id: d.room_id };
      this.root.add(ceiling);
    }
    scene.add(this.root);
  }
  dispose() {
    for (const o of this.root.children) o.geometry.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}
