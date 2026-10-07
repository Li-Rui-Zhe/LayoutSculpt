import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { installCutaway, updateCutaway } from "./cutaway.js";
import { installFixtureLights, updateFixtureLights } from "./fixtureLights.js";
import { materials, presets, showcase } from "../catalog.js";
import { frameBounds, visualCenter, perspectiveCenter } from "./viewFraming.js";

function disposeModel(root) {
  const geometries = new Set(),
    mats = new Set(),
    textures = new Set();
  root?.traverse((obj) => {
    if (obj.isLight) obj.shadow?.dispose();
    if (obj.geometry) geometries.add(obj.geometry);
    for (const m of [obj.material].flat().filter(Boolean)) {
      mats.add(m);
      Object.values(m).forEach((v) => {
        if (v?.isTexture) textures.add(v);
      });
    }
  });
  geometries.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
}

export class StudioScene {
  constructor(host, callbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.disposed = false;
    this.active = true;
    this.cachedModels = new Map();
    this.modelUrl = null;
    this.thumbnails = {};
    this.revision = 0;
    this.dirty = true;
    this.modelSize = new THREE.Vector3(10, 3, 8);
    this.center = new THREE.Vector3(0, 1.5, 0);
    this.topView = false;
    this.originals = new Map();
    this.surfaceTextures = new Map();
    this.lastFrame = performance.now();
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.domElement.dataset.rendererId = crypto.randomUUID();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#19262c");
    const pmrem = new THREE.PMREMGenerator(this.renderer),
      room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.32;
    room.dispose();
    pmrem.dispose();
    this.orthographicCamera = new THREE.OrthographicCamera(
      -10,
      10,
      8,
      -8,
      0.1,
      200,
    );
    this.perspectiveCamera = new THREE.PerspectiveCamera(22, 1, 0.1, 200);
    this.camera = this.perspectiveCamera;
    this.camera.position.set(12, 14, 18);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.55, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.55;
    this.controls.panSpeed = 0.65;
    this.controls.zoomSpeed = 0.7;
    this.controls.minZoom = 0.65;
    this.controls.maxZoom = 2.5;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 100;
    this.controls.minPolarAngle = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.43;
    this.controls.screenSpacePanning = false;
    this.controls.autoRotateSpeed = 0.45;
    this.controls.cursorStyle = "grab";
    this.controls.addEventListener("start", () => {
      this.interacting = true;
    });
    this.controls.addEventListener("end", () => {
      this.interacting = false;
    });
    this.controls.addEventListener("change", () => {
      updateCutaway(this.model, this.camera, {
        enabled: this.cutaway !== false,
        top: this.topView,
      });
      this.dirty = true;
      const zoom = this.zoomPercent();
      if (zoom !== this.lastZoom) {
        this.lastZoom = zoom;
        this.callbacks.onZoom?.(zoom);
      }
    });
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new GTAOPass(
      this.scene,
      this.camera,
      host.clientWidth,
      host.clientHeight,
    );
    this.ao.blendIntensity = 0.5;
    this.ao.updateGtaoMaterial({
      radius: 0.24,
      thickness: 0.6,
      distanceExponent: 1.5,
    });
    this.composer.addPass(this.ao);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new SMAAPass());
    this.hemi = new THREE.HemisphereLight("#dce8ee", "#64503a", 0.8);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#ffce95", 3.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -24,
      right: 24,
      top: 24,
      bottom: -24,
      near: 0.5,
      far: 80,
    });
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight("#b7e3f0", 1.1);
    this.fill.position.set(8, 5, 3);
    this.scene.add(this.fill);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({
        color: "#dce2dd",
        roughness: 1,
        metalness: 0,
      }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.49;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.guide = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        [
          [-6, -0.465, -4.6],
          [-6, -0.465, 4.9],
          [6, -0.465, 4.9],
          [6, -0.465, -4.6],
        ].map((p) => new THREE.Vector3(...p)),
      ),
      new THREE.LineBasicMaterial({
        color: "#b09360",
        transparent: true,
        opacity: 0.4,
      }),
    );
    this.scene.add(this.guide);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    const frame = () => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(frame);
      const now = performance.now();
      if (!this.active) {
        this.lastFrame = now;
        return;
      }
      this.controls.update(Math.min((now - this.lastFrame) / 1000, 0.05));
      this.lastFrame = now;
      if (this.dirty) {
        this.composer.render();
        this.dirty = false;
      }
      if (
        this.model &&
        this.thumbnailsDue &&
        now >= this.thumbnailsDue &&
        !this.interacting
      ) {
        this.thumbnailsDue = 0;
        this.refreshThumbnails();
      }
    };
    frame();
  }

  attach(host, callbacks) {
    this.observer.disconnect();
    this.host = host;
    this.callbacks = callbacks;
    host.appendChild(this.renderer.domElement);
    this.observer.observe(host);
    this.active = false;
  }

  detach() {
    this.setActive(false);
    this.callbacks = {};
    this.observer.disconnect();
    // 已离开的页面不能接收迟到的模型，也不能覆盖随后选择的任务。
    this.revision++;
  }

  setActive(active) {
    this.active = active;
    this.controls.enabled = active && !!this.model;
    if (active) {
      this.lastFrame = performance.now();
      this.resize();
    }
  }

  resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    if (this.width !== w || this.height !== h) {
      this.width = w;
      this.height = h;
      this.renderer.setSize(w, h);
      this.composer.setSize(w, h);
    }
    const aspect = w / h;
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    const framing = frameBounds(
      this.modelSize,
      direction,
      aspect,
      this.camera.fov || 35,
      1.12,
      this.framingPoints,
    );
    const v = framing.halfHeight;
    Object.assign(this.camera, {
      left: -v * aspect,
      right: v * aspect,
      top: v,
      bottom: -v,
      aspect,
    });
    this.frameHeight = v;
    if (this.camera.isPerspectiveCamera) {
      const distance = framing.distance;
      const previousDistance = this.camera.position.distanceTo(
        this.controls.target,
      );
      const relativeZoom =
        !this.fittingCamera && this.fitDistance
          ? this.fitDistance / previousDistance
          : 1;
      if (this.fittingCamera || this.fitDistance) {
        this.camera.position
          .copy(this.controls.target)
          .addScaledVector(direction, distance / relativeZoom);
        this.fitDistance = distance;
      }
      this.controls.minDistance = Math.max(1, this.modelSize.length() * 0.3);
      this.controls.maxDistance = Math.max(60, distance * 3);
    }
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    this.thumbnailsDue = performance.now() + 400;
    // 调整画布尺寸会清空缓冲区，在浏览器绘制前补齐当前帧。
    if (this.active && this.model) this.composer.render();
  }

  cacheCurrentModel() {
    if (!this.model) return;
    this.restoreMaterials();
    this.scene.remove(this.model);
    this.cachedModels.set(this.modelUrl, {
      model: this.model,
      originals: this.originals,
      size: this.modelSize.clone(),
      center: this.center.clone(),
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      zoom: this.camera.zoom,
      top: this.topView,
      thumbnails: this.thumbnails,
    });
    this.model = null;
    this.modelUrl = null;
    this.originals = new Map();
    // 当前模型之外最多缓存两个户型，避免显存随任务数量持续增长。
    while (this.cachedModels.size > 2) {
      const oldest = this.cachedModels.keys().next().value;
      disposeModel(this.cachedModels.get(oldest).model);
      this.cachedModels.delete(oldest);
    }
  }

  installModel(url, entry) {
    this.model = entry.model;
    this.modelUrl = url;
    this.originals = entry.originals || new Map();
    if (!entry.originals) {
      installCutaway(this.model);
      installFixtureLights(this.model, {
        sample: url === "/models/apartment.glb" || url === showcase.model_url,
      });
      const lightSurfaces = new Set(
        (this.model.userData.designLights || []).flatMap(
          ({ surfaces }) => surfaces || [],
        ),
      );
      this.model.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = !obj.userData.fixture_id && !lightSurfaces.has(obj);
        obj.receiveShadow = true;
        [obj.material].flat().forEach((m) => {
          for (const texture of [m.map, m.normalMap]) {
            if (texture)
              texture.anisotropy = Math.min(
                8,
                this.renderer.capabilities.getMaxAnisotropy(),
              );
          }
          if (!this.originals.has(m.uuid))
            this.originals.set(m.uuid, {
              material: m,
              color: m.color.clone(),
              map: m.map,
              normalMap: m.normalMap,
              normalScale: m.normalScale?.clone(),
              roughness: m.roughness,
              metalness: m.metalness,
            });
        });
      });
      const bounds = new THREE.Box3().setFromObject(this.model);
      const center = bounds.getCenter(new THREE.Vector3());
      bounds.getSize(this.modelSize);
      this.model.position.x -= center.x;
      this.model.position.y -= bounds.min.y;
      this.model.position.z -= center.z;
      this.center.set(0, this.modelSize.y / 2, 0);
    } else {
      this.modelSize.copy(entry.size);
      this.center.copy(entry.center);
    }
    this.controls.cursor.copy(this.center);
    this.controls.maxTargetRadius =
      Math.hypot(this.modelSize.x, this.modelSize.z) * 0.3;
    for (const camera of [
      this.camera,
      this.orthographicCamera,
      this.perspectiveCamera,
    ].filter(Boolean))
      camera.far = Math.max(200, this.modelSize.length() * 6);
    this.scene.add(this.model);
    const shadowSize = Math.hypot(this.modelSize.x, this.modelSize.z) * 0.6 + 1;
    Object.assign(this.sun.shadow.camera, {
      left: -shadowSize,
      right: shadowSize,
      top: shadowSize,
      bottom: -shadowSize,
    });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.ground.position.y = -0.04;
    this.guide.position.y = 0.445;
    this.guide.scale.set(this.modelSize.x / 10.4, 1, this.modelSize.z / 8);
    this.reset(entry.top || false);
    if (entry.position) {
      this.camera.position.copy(entry.position);
      this.controls.target.copy(entry.target);
      this.camera.zoom = entry.zoom;
      this.camera.updateProjectionMatrix();
      const rotate = this.controls.autoRotate;
      this.controls.autoRotate = false;
      this.controls.update(0);
      this.controls.autoRotate = rotate;
    }
    this.controls.enabled = this.active;
    this.apply(this.state);
    this.thumbnails = entry.thumbnails || {};
    this.callbacks.onThumbnails?.(this.thumbnails);
    this.presentModel();
  }

  presentModel() {
    // 首帧准备好再揭示画布，不能先显示上一任务或空白缓冲区。
    this.composer.render();
    this.renderer.domElement.dataset.modelUrl = this.modelUrl;
    this.renderer.domElement.style.visibility = "visible";
    this.callbacks.onError?.("");
    this.callbacks.onView?.(this.topView ? "top" : "perspective");
    this.callbacks.onZoom?.(this.zoomPercent());
    this.callbacks.onLoading?.(false);
    this.dirty = false;
  }

  loadModel(url) {
    return new GLTFLoader().loadAsync(url);
  }

  async load(url) {
    const revision = ++this.revision;
    if (this.modelUrl === url && this.model) {
      this.callbacks.onThumbnails?.(this.thumbnails);
      this.presentModel();
      return;
    }
    this.renderer.domElement.style.visibility = "hidden";
    // 先取出目标，避免缓存淘汰恰好释放即将使用的模型。
    const cached = this.cachedModels.get(url);
    this.cachedModels.delete(url);
    this.cacheCurrentModel();
    this.callbacks.onThumbnails?.({});
    this.callbacks.onError?.("");
    try {
      if (cached) {
        this.installModel(url, cached);
        return;
      }
      this.callbacks.onLoading?.(true);
      const gltf = await this.loadModel(url);
      if (this.disposed || revision !== this.revision) {
        disposeModel(gltf.scene);
        return;
      }
      this.installModel(url, { model: gltf.scene });
    } catch (error) {
      if (!this.disposed && revision === this.revision) {
        this.callbacks.onLoading?.(false);
        this.callbacks.onError?.(`模型加载失败：${error.message}`);
      }
    }
  }

  light(id) {
    const p = presets.find((v) => v.id === id) || presets[0],
      level = this.state?.daylight ?? 74;
    this.sun.color.set(p.color);
    this.sun.position.set(...p.position.map((v) => v * 1.8));
    this.sun.intensity = p.intensity * (0.45 + (level / 100) * 0.75);
    this.hemi.intensity = p.ambient * (0.5 + level / 100);
    this.hemi.color.set(id === "night" ? "#b4c6de" : "#dce8ee");
    this.hemi.groundColor.set(id === "night" ? "#b9a28e" : "#64503a");
    this.renderer.toneMappingExposure = p.exposure;
    this.fill.intensity = id === "night" ? 0.12 : 0.85;
    this.scene.environmentIntensity = id === "night" ? 0.18 : 0.4;
    this.scene.background.set(id === "night" ? "#45555e" : "#d8dcd7");
    this.ground.material.color.set(id === "night" ? "#394852" : "#dce2dd");
    if (this.modelUrl === showcase.model_url) {
      this.scene.background.set(id === "night" ? "#253a35" : "#eee5d5");
      this.ground.material.color.set(id === "night" ? "#253a35" : "#eee5d5");
      this.sun.position.set(-8, 10, 6);
      this.sun.intensity *= id === "night" ? 1 : 1.05;
      this.hemi.intensity *= id === "night" ? 1 : 0.5;
      this.fill.intensity = id === "night" ? 0.12 : 0.35;
      this.scene.environmentIntensity = id === "night" ? 0.22 : 0.38;
    }
    updateFixtureLights(this.model, id === "night");
    this.renderer.domElement.dataset.lightingPreset =
      id === "night" ? "night" : "midday";
    this.renderer.domElement.dataset.designLightCount = String(
      this.model?.userData.designLights?.length || 0,
    );
    this.renderer.domElement.dataset.hiddenFixtureVisualCount = String(
      this.model?.userData.hiddenFixtureVisualCount || 0,
    );
  }

  apply(state) {
    if (!state) return;
    this.state = state;
    this.restoreMaterials();
    for (const { material } of this.originals.values()) {
      const category =
        material.userData.surface_category ||
        (material.name.startsWith("墙面")
          ? "walls"
          : material.name.startsWith("地板")
            ? "floor"
            : material.name.startsWith("软装")
              ? "fabric"
              : null);
      const chosen =
        category && materials.find((m) => m.id === state.selected[category]);
      if (chosen) {
        material.color.set(chosen.color);
        const surface =
          category === "fabric"
            ? "linen"
            : chosen.texture === "wood"
              ? "planks"
              : chosen.texture === "stone"
                ? "stone"
                : chosen.texture === "linen"
                  ? "linen"
                  : null;
        material.map = surface ? this.surfaceTexture(surface, "color") : null;
        material.normalMap = surface
          ? this.surfaceTexture(surface, "normal")
          : null;
        material.normalScale?.setScalar(surface === "linen" ? 0.35 : 0.25);
        material.roughness =
          surface === "linen"
            ? 0.94
            : surface === "planks"
              ? 0.44
              : surface === "stone"
                ? 0.62
                : 0.8;
        material.metalness = 0;
        material.needsUpdate = true;
      }
    }
    this.light(state.preset);
    this.dirty = true;
    this.thumbnailsDue = performance.now() + 400;
  }

  restoreMaterials() {
    for (const original of this.originals.values()) {
      const material = original.material;
      const changed =
        material.map !== original.map ||
        material.normalMap !== original.normalMap;
      material.color.copy(original.color);
      material.map = original.map;
      material.normalMap = original.normalMap;
      if (original.normalScale) material.normalScale.copy(original.normalScale);
      material.roughness = original.roughness;
      material.metalness = original.metalness;
      if (changed) material.needsUpdate = true;
    }
  }

  surfaceTexture(surface, channel) {
    const key = `${surface}_${channel}`;
    if (!this.surfaceTextures.has(key)) {
      const texture = new THREE.TextureLoader().load(
        `/materials/${key}.png`,
        () => {
          if (this.disposed) return;
          this.dirty = true;
          this.thumbnailsDue = performance.now() + 400;
        },
      );
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.flipY = false;
      texture.anisotropy = Math.min(
        8,
        this.renderer.capabilities.getMaxAnisotropy(),
      );
      texture.colorSpace =
        channel === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      this.surfaceTextures.set(key, texture);
    }
    return this.surfaceTextures.get(key);
  }

  settings({ shadows = true, rotate = false, grid = true, cutaway = true }) {
    this.cutaway = cutaway;
    this.renderer.domElement.dataset.wallView = cutaway ? "cutaway" : "full";
    updateCutaway(this.model, this.camera, {
      enabled: cutaway,
      top: this.topView,
    });
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse((o) => {
        if (o.material)
          [o.material].flat().forEach((m) => (m.needsUpdate = true));
      });
    }
    this.autoRotate = rotate;
    this.controls.autoRotate = rotate && !this.topView;
    this.guide.visible = grid;
    this.dirty = true;
  }
  reset(top = false) {
    // 先耗尽残留惯性，避免复位后继续漂移。
    this.controls.autoRotate = false;
    this.controls.enableDamping = false;
    this.controls.update();
    this.topView = top;
    const nextCamera = top ? this.orthographicCamera : this.perspectiveCamera;
    if (nextCamera && nextCamera !== this.camera) {
      this.camera = nextCamera;
      this.controls.object = nextCamera;
      for (const pass of this.composer.passes || []) {
        if ("camera" in pass) pass.camera = nextCamera;
      }
      if (this.ao?.gtaoMaterial) {
        this.ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA =
          nextCamera.isPerspectiveCamera ? 1 : 0;
        this.ao.gtaoMaterial.needsUpdate = true;
      }
    }
    this.controls.enableRotate = !top;
    this.controls.minPolarAngle = top ? 0 : 0.08;
    this.controls.target.copy(this.center);
    const distance = Math.max(20, this.modelSize.length() * 2);
    const wideCanvas =
      (this.host?.clientWidth || this.width || 1) /
        (this.host?.clientHeight || this.height || 1) >=
      1.2;
    const longAlongZ = this.modelSize.z > this.modelSize.x;
    const showZAcross = wideCanvas ? longAlongZ : !longAlongZ;
    const offset = new THREE.Vector3(
      ...(top
        ? [0, 1, 0.00001]
        : this.modelUrl === showcase.model_url
          ? [1.1, 2.4, 2.6]
          : showZAcross
            ? [1.85, 3.1, 0.55]
            : [0.55, 3.1, 1.85]),
    )
      .normalize()
      .multiplyScalar(distance);
    updateCutaway(this.model, this.camera, {
      enabled: this.cutaway !== false,
      top,
    });
    const points = [];
    this.model?.updateMatrixWorld(true);
    this.model?.traverseVisible((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      obj.geometry.computeBoundingBox();
      const box = obj.geometry.boundingBox;
      if (!box || box.isEmpty()) return;
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            points.push(
              new THREE.Vector3(x, y, z)
                .applyMatrix4(obj.matrixWorld)
                .sub(this.center),
            );
          }
    });
    const aspect =
      (this.host?.clientWidth || this.width || 1) /
      (this.host?.clientHeight || this.height || 1);
    const shift = points.length
      ? top
        ? visualCenter(points, offset)
        : perspectiveCenter(points, offset, aspect, this.camera.fov || 22)
      : new THREE.Vector3();
    this.framingPoints = points.length
      ? points.map((point) => point.sub(shift))
      : null;
    this.controls.target.copy(this.center).add(shift);
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.zoom = 1;
    this.fittingCamera = true;
    this.resize();
    this.fittingCamera = false;
    this.controls.update();
    this.controls.enableDamping = true;
    this.controls.autoRotate = this.autoRotate && !top;
    updateCutaway(this.model, this.camera, {
      enabled: this.cutaway !== false,
      top,
    });
    this.dirty = true;
  }
  zoom(factor) {
    if (this.camera.isPerspectiveCamera) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const distance = THREE.MathUtils.clamp(
        offset.length() / factor,
        this.controls.minDistance,
        this.controls.maxDistance,
      );
      this.camera.position
        .copy(this.controls.target)
        .add(offset.setLength(distance));
      this.controls.update();
      this.dirty = true;
      this.callbacks.onZoom?.(this.zoomPercent());
      return;
    }
    this.camera.zoom = THREE.MathUtils.clamp(
      this.camera.zoom * factor,
      this.controls.minZoom,
      this.controls.maxZoom,
    );
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    this.callbacks.onZoom?.(Math.round(this.camera.zoom * 100));
  }
  zoomPercent() {
    return Math.round(
      this.camera.isPerspectiveCamera && this.fitDistance
        ? (100 * this.fitDistance) /
            this.camera.position.distanceTo(this.controls.target)
        : this.camera.zoom * 100,
    );
  }
  snapshot() {
    this.composer.render();
    return this.renderer.domElement.toDataURL("image/png");
  }
  thumbnail() {
    const canvas = document.createElement("canvas");
    canvas.width = 230;
    canvas.height = 150;
    const source = this.renderer.domElement;
    const scale = Math.min(230 / source.width, 150 / source.height);
    const w = source.width * scale,
      h = source.height * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#19262c";
    ctx.fillRect(0, 0, 230, 150);
    ctx.drawImage(source, (230 - w) / 2, (150 - h) / 2, w, h);
    return canvas.toDataURL("image/jpeg", 0.8);
  }
  refreshThumbnails() {
    const thumbs = {};
    try {
      for (const preset of presets) {
        this.light(preset.id);
        this.composer.render();
        thumbs[preset.id] = this.thumbnail();
      }
    } finally {
      // 缩略图借用画布渲染，必须同一帧恢复真实光照，不能留到下一帧。
      this.light(this.state?.preset || "midday");
      this.composer.render();
    }
    this.thumbnails = thumbs;
    this.callbacks.onThumbnails?.(thumbs);
    this.dirty = false;
  }
  dispose() {
    this.disposed = true;
    this.revision++;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.restoreMaterials();
    disposeModel(this.scene);
    this.cachedModels.forEach((entry) => disposeModel(entry.model));
    this.cachedModels.clear();
    this.environment.dispose();
    this.composer.passes.forEach((p) => p.dispose?.());
    this.composer.dispose();
    this.renderer.dispose();
    this.surfaceTextures.forEach((texture) => texture.dispose());
    this.renderer.domElement.remove();
  }
}
