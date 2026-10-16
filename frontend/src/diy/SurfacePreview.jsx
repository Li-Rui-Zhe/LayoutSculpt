import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { applyOptics } from "../materials/optics.js";

// 与保存材质使用同一张烘焙贴图和粗糙度，拖动可检查墙角与铺装。
export default function SurfacePreview({ url, roughness, optics, category }) {
  const host = useRef(null),
    runtime = useRef(null);
  useEffect(() => {
    const element = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f5f3eb");
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    room.dispose();
    pmrem.dispose();
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 50);
    camera.position.set(4.9, 4.2, 5.8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.9, 0);
    controls.enablePan = false;
    controls.minDistance = 4.8;
    controls.maxDistance = 12;
    controls.minAzimuthAngle = -0.15;
    controls.maxAzimuthAngle = 1.4;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    const daylight = new THREE.DirectionalLight("#fff5e2", 3.5);
    daylight.position.set(2.5, 5, 4);
    daylight.castShadow = true;
    daylight.shadow.mapSize.set(1024, 1024);
    daylight.shadow.bias = -0.001;
    scene.add(daylight, new THREE.HemisphereLight("#ffffff", "#c5bba6", 2.1));
    const finish = new THREE.MeshPhysicalMaterial({
      color: "#ffffff",
      roughness,
      side: THREE.DoubleSide,
    });
    applyOptics(finish, optics);
    const meshes = [];
    const block = (size, position, material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      meshes.push(mesh);
      return mesh;
    };
    const neutral = () =>
      new THREE.MeshStandardMaterial({ color: "#e9e5db", roughness: 0.85 });
    const floor = block(
      [3.2, 0.08, 2.8],
      [0, 0, 0],
      category === "floor"
        ? finish
        : new THREE.MeshStandardMaterial({ color: "#c7b399", roughness: 0.7 }),
    );
    const wall = block(
      [3.2, 2.25, 0.08],
      [0, 1.165, -1.4],
      category === "walls" ? finish : neutral(),
    );
    // 玻璃后方参照物用于观察透光；反射由环境光生成，不烘焙到颜色图。
    const references = [
      block(
        [0.6, 1.15, 0.22],
        [-0.65, 0.65, -2],
        new THREE.MeshStandardMaterial({ color: "#65816b" }),
      ),
      block(
        [0.45, 0.65, 0.22],
        [0.65, 0.4, -2],
        new THREE.MeshStandardMaterial({ color: "#bd825e" }),
      ),
      block(
        [2.8, 0.08, 2.4],
        [0, -0.45, 0],
        new THREE.MeshStandardMaterial({ color: "#65816b" }),
      ),
    ];
    block([0.08, 2.25, 2.8], [-1.6, 1.165, 0], neutral());
    block([3.18, 0.085, 0.025], [0, 0.08, -1.344], neutral());
    block([0.025, 0.085, 2.73], [-1.544, 0.08, 0.02], neutral());
    // 世界尺度 UV：每两米一块贴图，与实际户型模型一致。
    const target = category === "floor" ? floor : wall;
    const geometry = target.geometry,
      pos = geometry.attributes.position,
      uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++)
      uv.setXY(
        i,
        pos.getX(i) / 2,
        (category === "floor" ? pos.getZ(i) : pos.getY(i)) / 2,
      );
    const render = () => renderer.render(scene, camera);
    const resize = () => {
      const width = element.clientWidth,
        height = element.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    controls.addEventListener("change", render);
    controls.update();
    resize();
    runtime.current = { finish, render, references, target };
    return () => {
      runtime.current = null;
      observer.disconnect();
      controls.dispose();
      const mats = new Set(meshes.map((m) => m.material));
      for (const m of meshes) m.geometry.dispose();
      for (const mat of mats) {
        mat.map?.dispose();
        mat.dispose();
      }
      renderer.dispose();
      environment.dispose();
      renderer.domElement.remove();
    };
  }, [category]);
  useEffect(() => {
    const rt = runtime.current;
    if (!rt) return;
    rt.finish.roughness = roughness;
    applyOptics(rt.finish, optics);
    rt.target.castShadow = !(optics?.transmission > 0.4);
    rt.references.forEach((mesh, index) => {
      mesh.visible =
        optics?.transmission > 0 &&
        (category === "walls" ? index < 2 : index === 2);
    });
    rt.render();
  }, [roughness, optics, category]);
  useEffect(() => {
    const rt = runtime.current;
    if (!rt || !url) return;
    let cancelled = false;
    let texture;
    texture = new THREE.TextureLoader().load(url, () => {
      if (cancelled) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      rt.finish.map?.dispose();
      rt.finish.map = texture;
      rt.finish.needsUpdate = true;
      rt.render();
    });
    return () => {
      cancelled = true;
    };
  }, [url, category]);
  return (
    <div
      className="surface-three-preview"
      ref={host}
      role="img"
      aria-label={`${category === "walls" ? "墙面" : "地板"}三维材质预览，可拖动旋转`}
    />
  );
}
