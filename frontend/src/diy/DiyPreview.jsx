import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  installFixtureLights,
  updateFixtureLights,
} from "../viewer/fixtureLights.js";
import { installCutaway, updateCutaway } from "../viewer/cutaway.js";
import { materials } from "../catalog.js";
import { designBounds, designIssues } from "./design.js";
import { frameBounds, perspectiveCenter } from "../viewer/viewFraming.js";
import "./diy.css";

function dispose(group) {
  const resources = new Set();
  group.traverse((o) => {
    if (o.geometry) resources.add(o.geometry);
    for (const m of (Array.isArray(o.material)
      ? o.material
      : [o.material]
    ).filter(Boolean)) {
      resources.add(m);
      for (const value of Object.values(m))
        if (value?.isTexture) resources.add(value);
    }
  });
  resources.forEach((r) => r.dispose());
}
const views = { perspective: "三维", front: "正面", side: "侧面", top: "俯视" };
function fit(rt, view) {
  const bounds = new THREE.Box3();
  const points = [];
  rt.group.updateMatrixWorld(true);
  rt.group.traverseVisible((child) => {
    if (!child.isMesh || !child.geometry) return;
    child.geometry.computeBoundingBox();
    const box = child.geometry.boundingBox;
    if (!box || box.isEmpty()) return;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const p = new THREE.Vector3(x, y, z).applyMatrix4(child.matrixWorld);
          points.push(p);
          bounds.expandByPoint(p);
        }
  });
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3()),
    size = bounds.getSize(new THREE.Vector3());
  const directions = {
    perspective: [1.3, 0.9, 1.6 * (rt.frontDirection ?? -1)],
    front: [0, 0, rt.frontDirection ?? -1],
    side: [1, 0, 0],
    top: [0, 1, 0.0001],
  };
  const direction = new THREE.Vector3(...directions[view]).normalize(),
    scale = Math.max(size.length(), 0.01);
  const normalized = points.map((p) => p.sub(center).divideScalar(scale));
  const shift = perspectiveCenter(
    normalized,
    direction,
    rt.camera.aspect,
    rt.camera.fov,
  );
  const distance =
    frameBounds(
      new THREE.Vector3(),
      direction,
      rt.camera.aspect,
      rt.camera.fov,
      1.22,
      normalized.map((p) => p.sub(shift)),
    ).distance * scale;
  center.addScaledVector(shift, scale);
  rt.controls.target.copy(center);
  rt.camera.position
    .copy(center)
    .add(
      new THREE.Vector3(...directions[view])
        .normalize()
        .multiplyScalar(distance),
    );
  rt.camera.near = Math.max(0.001, distance / 1000);
  rt.camera.far = Math.max(100, distance * 10);
  rt.controls.maxDistance = Math.max(30, distance * 4);
  rt.camera.updateProjectionMatrix();
  rt.controls.update();
  rt.render();
}

// 按需渲染，切换部件只更新选中框，切换素材不重建 WebGL 上下文。
export default function DiyPreview({
  design,
  selected,
  onSelect,
  onTransform,
  assetKey,
  modelUrl,
  onInfo,
  onObjectSelect,
  cutaway = false,
  night = false,
  frontDirection = -1,
}) {
  const host = useRef(null),
    runtime = useRef(null),
    callbacks = useRef({ onSelect, onInfo, onObjectSelect, onTransform });
  callbacks.current = { onSelect, onInfo, onObjectSelect, onTransform };
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [transformMode, setTransformMode] = useState(null);
  const [solo, setSolo] = useState(false),
    [gridVisible, setGridVisible] = useState(!cutaway);
  const [view, setView] = useState("perspective"),
    [frame, setFrame] = useState(0),
    [version, setVersion] = useState(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const container = host.current;
    let disposed = false,
      renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError("当前设备无法打开三维预览，可继续编辑参数或下载 GLB。");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#edf0e9");
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    camera.position.set(3, 2.5, -4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 0.05;
    controls.maxDistance = 100;
    const group = new THREE.Group();
    scene.add(group);
    const ambient = new THREE.HemisphereLight(0xffffff, 0x70806d, 2.3);
    scene.add(ambient);
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, 6, -4);
    scene.add(light);
    const grid = new THREE.GridHelper(20, 80, 0xa7b3a1, 0xd7ded1);
    grid.position.y = -0.005;
    scene.add(grid);
    const selection = new THREE.BoxHelper(new THREE.Object3D(), 0x2d8b65);
    selection.visible = false;
    scene.add(selection);
    const render = () => {
      if (!disposed) renderer.render(scene, camera);
    };
    const rt = {
      scene,
      camera,
      controls,
      group,
      grid,
      selection,
      render,
      light,
      frontDirection,
      ambient,
      needsFit: true,
    };
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.7);
    scene.add(gizmo.getHelper());
    rt.gizmo = gizmo;
    gizmo.addEventListener("change", render);
    gizmo.addEventListener("dragging-changed", (e) => {
      controls.enabled = !e.value;
    });
    gizmo.addEventListener("mouseUp", () => {
      const mesh = gizmo.object,
        p = mesh?.userData.sourcePart,
        offset = mesh?.userData.designOffset;
      if (!p || !offset) return;
      const accepted = callbacks.current.onTransform?.(p.id, {
        x: mesh.position.x + offset.x,
        y: mesh.position.z + offset.y,
        z: Math.max(
          0,
          mesh.position.y - (p.height * mesh.scale.y) / 2 + offset.z,
        ),
        width: p.width * mesh.scale.x,
        depth: p.depth * mesh.scale.z,
        height: p.height * mesh.scale.y,
        rotation: ((((-mesh.rotation.y * 180) / Math.PI) % 360) + 360) % 360,
      });
      if (accepted === false) {
        mesh.scale.set(1, 1, 1);
        mesh.position.set(
          p.x - offset.x,
          p.z + p.height / 2 - offset.z,
          p.y - offset.y,
        );
        mesh.rotation.y = (-p.rotation * Math.PI) / 180;
        render();
      }
    });
    runtime.current = rt;
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (rt.needsFit) {
        fit(rt, viewRef.current);
        rt.needsFit = false;
      } else render();
    });
    container.appendChild(renderer.domElement);
    observer.observe(container);
    controls.addEventListener("change", render);
    let down;
    const pointerDown = (e) => {
      down = e.button === 0 ? [e.clientX, e.clientY] : null;
    };
    const pointerUp = (e) => {
      if (
        gizmo.dragging ||
        gizmo.axis ||
        !down ||
        Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5
      )
        return;
      down = null;
      const rect = renderer.domElement.getBoundingClientRect(),
        ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray
        .intersectObjects(
          group.children.filter((c) => c.visible),
          true,
        )
        .find((h) => {
          let o = h.object;
          while (o && o !== group) {
            if (!o.visible) return false;
            o = o.parent;
          }
          return (
            h.object.userData.partId ||
            (callbacks.current.onObjectSelect &&
              (h.object.userData.furniture_index != null ||
                h.object.userData.room_id ||
                h.object.userData.wall_id ||
                h.object.userData.wall_ids))
          );
        });
      if (hit) {
        callbacks.current.onSelect?.(hit.object.userData.partId);
        const p = group.children[0]?.worldToLocal(hit.point.clone());
        callbacks.current.onObjectSelect?.({
          ...hit.object.userData,
          point: p ? { x: p.x, y: p.z } : null,
        });
      }
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    return () => {
      disposed = true;
      observer.disconnect();
      gizmo.dispose();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      dispose(scene);
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);
  useEffect(() => {
    const rt = runtime.current;
    if (!rt) return;
    rt.frontDirection = frontDirection;
    rt.light.position.z = 4 * frontDirection;
    rt.needsFit = true;
  }, [frontDirection]);
  useEffect(() => {
    if (cutaway && runtime.current?.group.children.length) return;
    setSolo(false);
    setView("perspective");
    if (runtime.current) runtime.current.needsFit = true;
  }, [assetKey, modelUrl]);
  useEffect(() => {
    if (modelUrl) return;
    const rt = runtime.current;
    if (!rt) return;
    if (design && designIssues(design).length) {
      setError("参数尚未通过检查，暂时保留上次有效预览。");
      return;
    }
    rt.gizmo.detach();
    dispose(rt.group);
    rt.group.clear();
    setError("");
    if (design) {
      const { low, high } = designBounds(design);
      for (const p of design.parts) {
        if (p.edit_hidden) continue;
        const geometry =
          p.shape === "box"
            ? new THREE.BoxGeometry(p.width, p.height, p.depth)
            : p.shape === "rounded_box"
              ? new RoundedBoxGeometry(
                  p.width,
                  p.height,
                  p.depth,
                  4,
                  Math.min(p.width, p.height, p.depth) * 0.16,
                )
              : p.shape === "cone"
                ? new THREE.ConeGeometry(0.5, 1, 32)
                : p.shape === "cylinder"
                  ? new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
                  : new THREE.SphereGeometry(0.5, 24, 16);
        if (!["box", "rounded_box"].includes(p.shape))
          geometry.scale(p.width, p.height, p.depth);
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: p.color,
            roughness: p.roughness,
            metalness: p.metallic,
          }),
        );
        mesh.position.set(
          p.x - (low[0] + high[0]) / 2,
          p.z + p.height / 2 - low[2],
          p.y - (low[1] + high[1]) / 2,
        );
        mesh.rotation.y = (-p.rotation * Math.PI) / 180;
        const finish = materials.find((m) => m.id === p.material_id);
        const surface =
          finish?.surface ||
          { wood: "planks", stone: "stone", linen: "linen" }[finish?.texture];
        if (surface) {
          const loader = new THREE.TextureLoader();
          mesh.material.map = loader.load(
            `/materials/${surface}_color.png`,
            () => rt.render(),
          );
          mesh.material.map.colorSpace = THREE.SRGBColorSpace;
          mesh.material.map.wrapS = mesh.material.map.wrapT =
            THREE.RepeatWrapping;
          const geom = mesh.geometry.index
            ? mesh.geometry.toNonIndexed()
            : mesh.geometry;
          if (geom !== mesh.geometry) {
            mesh.geometry.dispose();
            mesh.geometry = geom;
          }
          const points = geom.attributes.position,
            normals = geom.attributes.normal,
            uv = new Float32Array(points.count * 2);
          for (let i = 0; i < points.count; i++) {
            const values = [points.getX(i), points.getY(i), points.getZ(i)],
              ns = [
                Math.abs(normals.getX(i)),
                Math.abs(normals.getY(i)),
                Math.abs(normals.getZ(i)),
              ],
              axis = ns.indexOf(Math.max(...ns));
            const axes = [0, 1, 2].filter((a) => a !== axis);
            uv[i * 2] = values[axes[0]];
            uv[i * 2 + 1] = values[axes[1]];
          }
          geom.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        }
        mesh.userData.partId = p.id;
        mesh.userData.sourcePart = p;
        mesh.userData.designOffset = {
          x: (low[0] + high[0]) / 2,
          y: (low[1] + high[1]) / 2,
          z: low[2],
        };
        rt.group.add(mesh);
      }
      if (!rt.hadDesign) rt.needsFit = true;
    }
    rt.hadDesign = !!design;
    setVersion((n) => n + 1);
  }, [design, modelUrl]);
  useEffect(() => {
    if (!modelUrl || !runtime.current) return;
    const rt = runtime.current,
      abort = new AbortController();
    let alive = true;
    rt.selection.visible = false;
    setLoading(true);
    setError("");
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (url.startsWith("blob:") || url.startsWith("data:")) return url;
      throw Error("此 GLB 引用了外部资源，请使用内嵌纹理的 GLB。");
    });
    const load = async () => {
      const response = await fetch(modelUrl, { signal: abort.signal });
      if (!response.ok) throw Error("模型无法读取，请刷新素材库后重试。");
      const buffer = await response.arrayBuffer();
      if (!alive) return;
      const gltf = await new GLTFLoader(manager).parseAsync(buffer, "");
      if (!alive) {
        dispose(gltf.scene);
        return;
      }
      const bounds = new THREE.Box3().setFromObject(gltf.scene),
        size = bounds.getSize(new THREE.Vector3()),
        center = bounds.getCenter(new THREE.Vector3());
      if (bounds.isEmpty() || ![...size].every(Number.isFinite)) {
        dispose(gltf.scene);
        throw Error("模型中没有可预览的有效几何体。");
      }
      gltf.scene.position.sub(
        new THREE.Vector3(center.x, bounds.min.y, center.z),
      );
      let meshes = 0,
        triangles = 0;
      gltf.scene.traverse((o) => {
        if (o.isMesh) {
          meshes++;
          triangles +=
            (o.geometry.index?.count ||
              o.geometry.attributes.position?.count ||
              0) / 3;
        }
      });
      if (cutaway) {
        installFixtureLights(gltf.scene);
        installCutaway(gltf.scene);
        updateCutaway(gltf.scene, rt.camera, { enabled: true });
      }
      const firstLoad = !rt.group.children.length;
      dispose(rt.group);
      rt.group.clear();
      rt.group.add(gltf.scene);
      rt.needsFit = firstLoad || !cutaway;
      callbacks.current.onInfo?.({
        dimensions: [size.x, size.z, size.y],
        meshes,
        triangles: Math.round(triangles),
        bytes: buffer.byteLength,
      });
      setVersion((n) => n + 1);
    };
    load()
      .catch((e) => {
        if (alive) setError(e.message || "模型预览失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      abort.abort();
    };
  }, [modelUrl]);
  useEffect(() => {
    const rt = runtime.current;
    if (!rt) return;
    rt.ambient.intensity = night ? 0.2 : 2.3;
    rt.light.intensity = night ? 0.12 : 3;
    rt.scene.background.set(night ? "#1b2930" : "#edf0e9");
    rt.group.children.forEach((model) => updateFixtureLights(model, night));
    rt.render();
  }, [night, version]);
  useEffect(() => {
    const rt = runtime.current;
    if (!rt) return;
    let picked = null;
    for (const mesh of rt.group.children) {
      mesh.visible = !solo || !selected || mesh.userData.partId === selected;
      if (mesh.userData.partId === selected && selected) picked = mesh;
    }
    if (
      picked &&
      transformMode &&
      callbacks.current.onTransform &&
      !picked.userData.sourcePart?.edit_locked
    ) {
      rt.gizmo.setMode(transformMode);
      rt.gizmo.showX = transformMode !== "rotate";
      rt.gizmo.showZ = transformMode !== "rotate";
      rt.gizmo.showY = true;
      rt.gizmo.attach(picked);
    } else rt.gizmo.detach();
    rt.selection.visible = !!picked;
    if (picked) rt.selection.setFromObject(picked);
    rt.grid.visible = gridVisible;
    if (
      rt.needsFit ||
      rt.lastView !== view ||
      rt.lastFrame !== frame ||
      rt.lastSolo !== solo ||
      (solo && rt.lastSelected !== selected)
    ) {
      fit(rt, view);
      rt.needsFit = false;
    }
    rt.lastView = view;
    rt.lastFrame = frame;
    rt.lastSolo = solo;
    rt.lastSelected = selected;
    rt.render();
  }, [
    selected,
    solo,
    gridVisible,
    view,
    frame,
    version,
    frontDirection,
    transformMode,
  ]);
  return (
    <div className="diy-preview-wrap">
      <div
        ref={host}
        className="diy-preview"
        aria-label={modelUrl ? "GLB 模型三维预览" : "DIY 素材三维预览"}
      />
      <div className="diy-view-toolbar" aria-label="模型查看工具">
        {design &&
          onTransform &&
          [
            ["translate", "移动部件"],
            ["rotate", "旋转部件"],
            ["scale", "缩放部件"],
          ].map(([id, label]) => (
            <button
              key={id}
              disabled={!selected}
              aria-pressed={transformMode === id}
              onClick={() => setTransformMode(transformMode === id ? null : id)}
            >
              {label}
            </button>
          ))}
        {Object.entries(views).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={view === id}
            onClick={() => {
              setView(id);
              setFrame((n) => n + 1);
            }}
          >
            {label}
          </button>
        ))}
        <button onClick={() => setFrame((n) => n + 1)}>适配模型</button>
        <button
          aria-pressed={gridVisible}
          onClick={() => setGridVisible(!gridVisible)}
        >
          网格
        </button>
        {!modelUrl && (
          <button
            disabled={!selected}
            aria-pressed={solo}
            onClick={() => setSolo(!solo)}
          >
            只看选中
          </button>
        )}
      </div>
      <span className="diy-preview-hint">
        拖动旋转 · 滚轮缩放{!modelUrl && " · 点选部件"}
      </span>
      {loading && (
        <div className="diy-preview-message" role="status">
          正在加载三维模型…
        </div>
      )}
      {error && (
        <div className="diy-preview-message" role="alert">
          {error}
        </div>
      )}
      {!design && !modelUrl && (
        <div className="diy-preview-empty">
          <strong>从一个想法开始</strong>
          <span>输入描述让 AI 设计，或从左侧选择已有素材。</span>
        </div>
      )}
    </div>
  );
}
