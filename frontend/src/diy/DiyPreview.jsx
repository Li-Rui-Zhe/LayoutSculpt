import OperationStatus from "../components/OperationStatus.jsx";
import ContextRecovery from "../viewer/ContextRecovery.jsx";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { interactionQuality } from "../viewer/interactionQuality.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  installFixtureLights,
  updateFixtureLights,
} from "../viewer/fixtureLights.js";
import { installCutaway, updateCutaway } from "../viewer/cutaway.js";
import { repairLegacyWallMaterials } from "../viewer/materialCompatibility.js";
import { materials } from "../catalog.js";
import furnitureMaterials from "../../../assets/materials/furniture.json" with { type: "json" };
import { designBounds, designIssues } from "./design.js";
import { frameBounds, perspectiveCenter } from "../viewer/viewFraming.js";
import "./diy.css";
import {
  bindLiveFurniture,
  syncLiveFurniture,
  liveKey,
  planOrigin,
  installEditProxies,
} from "../editor/liveModel.js";
import { installFurniturePlacement } from "../editor/scenePlacement.js";
import { furnitureCorners } from "../editor/geometry.js";
import { installDirectDrag } from "../editor/directSceneDrag.js";
import {
  isRoomFloorHit,
  clearRoomHighlight,
  updateRoomHighlight,
} from "../editor/roomSelection.js";
import { scenePose, sceneModes } from "../editor/sceneEdits.js";
import {
  updateLiveArchitecture,
  clearLiveArchitecture,
} from "../editor/liveArchitecture.js";

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
    if (!child.isMesh || !child.geometry || child.userData.editor_proxy) return;
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
  emptyContent,
  onObjectSelect,
  selectionType = null,
  cutaway = false,
  night = false,
  frontDirection = -1,
  modelDocument,
  liveDocument,
  liveSelection,
  liveEditable = false,
  onModelReady,
  onModelError,
  onSceneGesture,
  placement,
  onPlacementMove,
  onPlacementConfirm,
}) {
  const host = useRef(null),
    runtime = useRef(null),
    callbacks = useRef({ onSelect, onInfo, onObjectSelect, onTransform });
  callbacks.current = {
    onSelect,
    onInfo,
    onObjectSelect,
    selectionType,
    onTransform,
    onModelReady,
    onModelError,
    liveDocument,
    modelDocument,
    onSceneGesture,
    placement,
    onPlacementMove,
    onPlacementConfirm,
    liveSelection,
    liveEditable,
    cutaway,
  };
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [transformMode, setTransformMode] = useState(
    modelDocument ? "direct" : null,
  );
  useEffect(() => {
    if (liveSelection?.type === "furniture" && transformMode === "rotate")
      setTransformMode("direct");
  }, [liveSelection?.type, transformMode]);
  callbacks.current.transformMode = transformMode;
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
      callbacks.current.onModelError?.(
        "当前设备无法打开三维预览，可继续编辑参数或下载 GLB。",
      );
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
    const quality = interactionQuality({
      ratio: window.devicePixelRatio,
      apply: (ratio) => {
        renderer.setPixelRatio(ratio);
        render();
      },
    });
    controls.addEventListener("start", quality.start);
    controls.addEventListener("end", quality.end);
    renderer.domElement.addEventListener("pointerdown", quality.start);
    window.addEventListener("pointerup", quality.end);
    window.addEventListener("pointercancel", quality.end);
    window.addEventListener("blur", quality.restore);
    const rt = {
      renderer,
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
    rt.editHandle = new THREE.Object3D();
    rt.editHandle.userData.sceneHandle = true;
    scene.add(rt.editHandle);
    const sceneTransform = () => ({
      x: rt.editHandle.position.x + rt.liveOrigin.x,
      y: rt.editHandle.position.z + rt.liveOrigin.y,
      elevation: rt.editHandle.position.y,
      rotation: -THREE.MathUtils.radToDeg(rt.editHandle.rotation.y),
      scale: {
        x: rt.editHandle.scale.x,
        y: rt.editHandle.scale.y,
        z: rt.editHandle.scale.z,
      },
    });
    gizmo.addEventListener("mouseDown", () => {
      if (gizmo.object !== rt.editHandle) return;
      rt.liveCancelled = false;
      callbacks.current.onSceneGesture?.("start", sceneTransform());
    });
    gizmo.addEventListener("objectChange", () => {
      if (gizmo.object === rt.editHandle && gizmo.dragging && !rt.liveCancelled)
        callbacks.current.onSceneGesture?.("preview", sceneTransform());
    });
    const cancelGesture = (event) => {
      if (
        event.key !== "Escape" ||
        !gizmo.dragging ||
        gizmo.object !== rt.editHandle
      )
        return;
      rt.liveCancelled = true;
      gizmo.reset();
      callbacks.current.onSceneGesture?.("cancel");
    };
    window.addEventListener("keydown", cancelGesture);
    gizmo.addEventListener("change", render);
    gizmo.addEventListener("dragging-changed", (e) => {
      controls.enabled = !e.value;
    });
    gizmo.addEventListener("mouseUp", () => {
      if (gizmo.object === rt.editHandle) {
        if (!rt.liveCancelled)
          callbacks.current.onSceneGesture?.("end", sceneTransform());
        return;
      }
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
      const firstSize = !rt.sized;
      rt.sized = true;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (rt.needsFit || firstSize) {
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
    const rayAt = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      return ray.ray;
    };
    const pick = (e) => {
      const rect = renderer.domElement.getBoundingClientRect(),
        ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const pickData = (object) => {
        let data = {};
        while (object && object !== group) {
          data = { ...object.userData, ...data };
          object = object.parent;
        }
        return data;
      };
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
          const data = pickData(h.object);
          if (
            callbacks.current.selectionType === "rooms" &&
            !isRoomFloorHit(data)
          )
            return false;
          // 剖切隐藏掉的门窗上半部不能留下透明点击墙，遮住后面的家具。
          if (
            data.editor_proxy &&
            data.opening_index != null &&
            callbacks.current.cutaway &&
            h.point.y > 1.2
          )
            return false;
          return (
            data.partId ||
            (callbacks.current.onObjectSelect &&
              (data.live_selection ||
                data.furniture_index != null ||
                data.opening_index != null ||
                data.fixture_id ||
                data.fixture_owner_id ||
                data.room_id ||
                data.wall_id ||
                data.wall_ids))
          );
        });
      if (hit) {
        const data = pickData(hit.object);
        const p = group.children[0]?.worldToLocal(hit.point.clone());
        const origin = rt.modelDocument
          ? planOrigin(rt.modelDocument)
          : { x: 0, y: 0 };
        return {
          point: hit.point,
          data: {
            ...data,
            point: p ? { x: p.x + origin.x, y: p.z + origin.y } : null,
          },
        };
      }
      return null;
    };
    const pointerUp = (e) => {
      const start = down;
      down = null;
      if (
        gizmo.dragging ||
        gizmo.axis ||
        !start ||
        Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5
      )
        return;
      const hit = pick(e);
      if (hit) {
        callbacks.current.onSelect?.(hit.data.partId);
        callbacks.current.onObjectSelect?.(hit.data, rt.modelDocument);
      }
    };
    const removePlacement = installFurniturePlacement({
      element: renderer.domElement,
      rt,
      callbacks,
      rayAt,
    });
    const removeDirectDrag = installDirectDrag({
      element: renderer.domElement,
      rt,
      callbacks,
      pick,
      rayAt,
    });
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    return () => {
      disposed = true;
      quality.close();
      window.removeEventListener("pointerup", quality.end);
      window.removeEventListener("pointercancel", quality.end);
      window.removeEventListener("blur", quality.restore);
      renderer.domElement.removeEventListener("pointerdown", quality.start);
      observer.disconnect();
      removePlacement();
      removeDirectDrag();
      window.removeEventListener("keydown", cancelGesture);
      clearLiveArchitecture(rt);
      clearRoomHighlight(rt);
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
    if ((cutaway || modelDocument) && runtime.current?.group.children.length)
      return;
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
        const finish = [...furnitureMaterials, ...materials].find(
          (m) => m.id === p.material_id,
        );
        if (finish?.opacity < 1) {
          mesh.material.transparent = true;
          mesh.material.opacity = finish.opacity;
          mesh.material.depthWrite = false;
          mesh.material.side = THREE.DoubleSide;
        }
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
      repairLegacyWallMaterials(gltf.scene);
      if (!alive) {
        dispose(gltf.scene);
        return;
      }
      // 背景精细模型到达时，不打断正在进行的鼠标手势。
      while (alive && (rt.directDragging || rt.gizmo.dragging))
        await new Promise((resolve) => setTimeout(resolve, 50));
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
      if (modelDocument) {
        const origin = planOrigin(modelDocument);
        rt.liveOrigin ||= origin;
        gltf.scene.position.set(
          origin.x - rt.liveOrigin.x,
          0,
          origin.y - rt.liveOrigin.y,
        );
      } else
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
      if (cutaway || modelDocument) {
        installFixtureLights(gltf.scene);
        installCutaway(gltf.scene);
        updateCutaway(gltf.scene, rt.camera, { enabled: cutaway });
      }
      if (modelDocument) installEditProxies(gltf.scene, modelDocument);
      const firstLoad = !rt.group.children.length;
      rt.cancelDirectDrag?.();
      if (rt.gizmo.dragging) callbacks.current.onSceneGesture?.("cancel");
      rt.gizmo.detach();
      clearLiveArchitecture(rt);
      rt.modelDocument = modelDocument;
      rt.liveGroups = modelDocument
        ? bindLiveFurniture(gltf.scene, modelDocument)
        : null;
      if (rt.liveGroups && callbacks.current.liveDocument)
        syncLiveFurniture(rt.liveGroups, callbacks.current.liveDocument);
      dispose(rt.group);
      rt.group.clear();
      rt.group.add(gltf.scene);
      rt.needsFit = firstLoad || (!cutaway && !modelDocument);
      callbacks.current.onInfo?.({
        dimensions: [size.x, size.z, size.y],
        meshes,
        triangles: Math.round(triangles),
        bytes: buffer.byteLength,
      });
      setVersion((n) => n + 1);
      callbacks.current.onModelReady?.(modelUrl);
    };
    load()
      .catch((e) => {
        if (alive) {
          setError(e.message || "模型预览失败");
          callbacks.current.onModelError?.(e.message || "模型预览失败");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      abort.abort();
    };
  }, [modelUrl]);
  const placing = !!placement;
  useEffect(() => {
    const rt = runtime.current;
    if (!rt || !placing) return;
    const previous = { ...rt.controls.mouseButtons };
    rt.controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    return () => {
      rt.controls.mouseButtons = previous;
    };
  }, [placing]);
  useEffect(() => {
    const rt = runtime.current;
    if (!rt) return;
    if (placement) rt.gizmo.detach();
    if (!placement?.item || !rt.liveOrigin) return;
    const item = placement.item;
    const points = furnitureCorners(item).map(
      (p) =>
        new THREE.Vector3(p.x - rt.liveOrigin.x, 0.035, p.y - rt.liveOrigin.y),
    );
    points.push(points[0].clone());
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: placement.valid ? 0x059669 : 0xef4444,
      depthTest: false,
    });
    const marker = new THREE.Line(geometry, material);
    marker.renderOrder = 1000;
    rt.scene.add(marker);
    rt.render();
    return () => {
      rt.scene.remove(marker);
      geometry.dispose();
      material.dispose();
      rt.render();
    };
  }, [placement, version]);
  useEffect(() => {
    const rt = runtime.current;
    if (!rt || !modelDocument) return;
    rt.group.children.forEach((model) =>
      updateCutaway(model, rt.camera, { enabled: cutaway }),
    );
    rt.render();
  }, [cutaway, version]);
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
    if (rt.liveGroups && liveDocument && !rt.gizmo.dragging) {
      syncLiveFurniture(rt.liveGroups, liveDocument);
      if (liveSelection?.type === "furniture") {
        const item = liveDocument.furniture.items[liveSelection.index];
        if (item && !item.edit_hidden)
          picked = rt.liveGroups.get(liveKey(item, liveSelection.index));
      }
    }
    // 即使拖动的是结构手柄，家具位置也从同一草稿更新。
    if (rt.liveGroups && liveDocument && rt.gizmo.object === rt.editHandle)
      syncLiveFurniture(rt.liveGroups, liveDocument);
    if (liveDocument) updateLiveArchitecture(rt, liveDocument, cutaway, night);
    if (modelDocument) updateRoomHighlight(rt, liveDocument, liveSelection);
    else clearRoomHighlight(rt);
    for (const mesh of rt.group.children) {
      mesh.visible = !solo || !selected || mesh.userData.partId === selected;
      if (mesh.userData.partId === selected && selected) picked = mesh;
    }
    if (
      picked &&
      transformMode &&
      callbacks.current.onTransform &&
      !picked.userData.sourcePart?.edit_locked &&
      !(
        picked.userData.liveFurniture &&
        liveDocument?.furniture.items[liveSelection?.index]?.edit_locked
      )
    ) {
      rt.gizmo.setMode(transformMode);
      rt.gizmo.showX = transformMode !== "rotate";
      rt.gizmo.showZ = transformMode !== "rotate";
      rt.gizmo.showY = true;
      rt.gizmo.attach(picked);
    } else if (
      modelDocument &&
      liveSelection &&
      onSceneGesture &&
      liveEditable &&
      (!loading || rt.group.children.length > 0)
    ) {
      const pose = scenePose(liveDocument, liveSelection);
      const object =
        liveSelection.type === "furniture"
          ? liveDocument.furniture.items[liveSelection.index]
          : liveDocument.layout[liveSelection.type]?.[liveSelection.index];
      if (
        pose &&
        !object?.edit_locked &&
        !object?.edit_hidden &&
        transformMode &&
        !(liveSelection.type === "furniture" && transformMode === "rotate") &&
        sceneModes(liveSelection.type).includes(transformMode)
      ) {
        if (!rt.gizmo.dragging) {
          rt.editHandle.position.set(
            pose.x - rt.liveOrigin.x,
            pose.elevation,
            pose.y - rt.liveOrigin.y,
          );
          rt.editHandle.rotation.set(
            0,
            -THREE.MathUtils.degToRad(pose.rotation),
            0,
          );
          rt.editHandle.scale.set(1, 1, 1);
        }
        rt.gizmo.setMode(transformMode);
        rt.gizmo.setSpace(
          ["walls", "openings"].includes(liveSelection.type) ||
            transformMode === "scale"
            ? "local"
            : "world",
        );
        rt.gizmo.showX = transformMode !== "rotate";
        rt.gizmo.showZ =
          transformMode !== "rotate" && liveSelection.type !== "openings";
        rt.gizmo.showY =
          liveSelection.type === "rooms"
            ? transformMode === "rotate"
            : liveSelection.type === "walls"
              ? transformMode !== "translate"
              : liveSelection.type === "openings"
                ? transformMode === "scale" || object.kind === "window"
                : true;
        if (rt.gizmo.object !== rt.editHandle) rt.gizmo.attach(rt.editHandle);
      } else rt.gizmo.detach();
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
    liveDocument,
    liveSelection,
    liveEditable,
    loading,
    cutaway,
    night,
  ]);
  const liveObject =
    liveSelection &&
    liveDocument &&
    (liveSelection.type === "furniture"
      ? liveDocument.furniture.items
      : liveDocument.layout[liveSelection.type])?.[liveSelection.index];
  return (
    <div
      className="diy-preview-wrap"
      data-selected-room={
        liveSelection?.type === "rooms" ? liveObject?.id : undefined
      }
    >
      <ContextRecovery
        target={() => runtime.current?.renderer.domElement}
        onLost={() => {
          runtime.current?.cancelDirectDrag?.();
          runtime.current?.gizmo.reset();
          callbacks.current.onSceneGesture?.("cancel");
          if (runtime.current) runtime.current.controls.enabled = true;
        }}
        onRestored={() => {
          runtime.current?.render();
          setVersion((n) => n + 1);
        }}
      />
      <div
        ref={host}
        className="diy-preview"
        aria-label={
          modelDocument
            ? "户型三维编辑画布"
            : modelUrl
              ? "GLB 模型三维预览"
              : "DIY 素材三维预览"
        }
      />
      <div className="diy-view-toolbar" aria-label="模型查看工具">
        {modelDocument ? (
          <>
            {!placement && (
              <label className="scene-toolbar-select">
                操作
                <select
                  aria-label="三维操作方式"
                  value={transformMode || "direct"}
                  onChange={(e) => setTransformMode(e.target.value)}
                >
                  <option value="direct">直接拖动</option>
                  <option value="orbit">浏览视角</option>
                  {[
                    ["translate", "精确移动"],
                    ["rotate", "旋转结构"],
                    ["scale", "缩放对象"],
                  ]
                    .filter(
                      ([mode]) =>
                        !(
                          mode === "rotate" &&
                          liveSelection?.type === "furniture"
                        ),
                    )
                    .map(([mode, label]) => (
                      <option
                        key={mode}
                        value={mode}
                        disabled={
                          !liveEditable ||
                          !liveSelection ||
                          !liveObject ||
                          liveObject.edit_locked ||
                          liveObject.edit_hidden ||
                          !sceneModes(liveSelection.type).includes(mode)
                        }
                      >
                        {label}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="scene-toolbar-select">
              视角
              <select
                aria-label="三维观察视角"
                value={view}
                onChange={(e) => {
                  setView(e.target.value);
                  setFrame((n) => n + 1);
                }}
              >
                {Object.entries(views).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => setFrame((n) => n + 1)}>居中</button>
            <details className="scene-view-more">
              <summary>辅助</summary>
              <div>
                <button
                  aria-pressed={gridVisible}
                  onClick={() => setGridVisible(!gridVisible)}
                >
                  {gridVisible ? "隐藏网格" : "显示网格"}
                </button>
              </div>
            </details>
          </>
        ) : (
          <>
            {!placement &&
              ((design && onTransform) || (modelDocument && onSceneGesture)) &&
              [
                ...(modelDocument
                  ? [
                      ["direct", "直接拖动"],
                      ["orbit", "浏览视角"],
                    ]
                  : []),
                ["translate", "移动部件"],
                ["rotate", "旋转部件"],
                ["scale", "缩放部件"],
              ]
                .filter(
                  ([id]) =>
                    !(
                      modelDocument &&
                      liveSelection?.type === "furniture" &&
                      id === "rotate"
                    ),
                )
                .map(([id, label]) => (
                  <button
                    key={id}
                    disabled={
                      modelDocument
                        ? !["direct", "orbit"].includes(id) &&
                          (!liveEditable ||
                            !liveSelection ||
                            !liveObject ||
                            liveObject.edit_locked ||
                            liveObject.edit_hidden ||
                            (id !== "direct" &&
                              !sceneModes(liveSelection.type).includes(id)))
                        : !selected
                    }
                    aria-pressed={transformMode === id}
                    onClick={() =>
                      setTransformMode(
                        transformMode === id
                          ? modelDocument
                            ? "direct"
                            : null
                          : id,
                      )
                    }
                  >
                    {modelDocument ? label.replace("部件", "对象") : label}
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
            {!modelUrl && !modelDocument && (
              <button
                disabled={!selected}
                aria-pressed={solo}
                onClick={() => setSolo(!solo)}
              >
                只看选中
              </button>
            )}
          </>
        )}
      </div>
      <span className="diy-preview-hint">
        {placement
          ? "绿色可放置 · 红色表示冲突 · R 旋转 · Esc 取消"
          : modelDocument
            ? "拖动物体摆放 · 空白处拖动旋转视角 · 滚轮缩放"
            : "拖动旋转 · 滚轮缩放"}
        {!modelUrl && !modelDocument && " · 点选部件"}
      </span>
      {loading && !modelDocument && (
        <div className="diy-preview-message">
          <OperationStatus
            active={loading}
            label="正在加载精细模型"
            detail="完成后将在当前预览区显示。"
          />
        </div>
      )}
      {error && (
        <div className="diy-preview-message" role="alert">
          {error}
        </div>
      )}
      {!design && !modelUrl && !modelDocument && (
        <div className="diy-preview-empty">
          {emptyContent || (
            <>
              <strong>从一个想法开始</strong>
              <span>输入描述让 AI 设计，或从左侧选择已有素材。</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
