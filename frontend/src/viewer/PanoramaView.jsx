import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const pitchLimit = THREE.MathUtils.degToRad(42);
const seamWidth = 0.012;

// 直接用全景图采样视线，避免重投影成低分辨率立方体。
const panoramaShader = {
  vertexShader: `
    uniform mat4 inverseProjection;
    uniform mat4 viewToWorld;
    varying vec3 worldRay;

    void main() {
      vec4 ray = inverseProjection * vec4(position.xy, 1.0, 1.0);
      worldRay = (viewToWorld * vec4(ray.xyz, 0.0)).xyz;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    #include <common>
    uniform sampler2D panorama;
    uniform float blendWidth;
    varying vec3 worldRay;

    void main() {
      vec2 uv = equirectUv(normalize(worldRay));
      vec4 color = texture2D(panorama, uv);
      float distanceToSeam = min(uv.x, 1.0 - uv.x);
      if (distanceToSeam < blendWidth) {
        vec3 wrapped = texture2D(panorama, vec2(1.0 - uv.x, uv.y)).rgb;
        // 在同一纬度合拢两侧，仅在接缝的窄带内做过渡。
        float weight = 0.5 * (1.0 - smoothstep(0.0, blendWidth, distanceToSeam));
        color.rgb = mix(color.rgb, wrapped, weight);
      }
      gl_FragColor = color;
      #include <colorspace_fragment>
    }
  `,
};

export default function PanoramaView({
  src,
  label,
  initialHeading = 0,
  initialPitch = 0,
  smoothSeam = false,
  doors = [],
  onRoomChange,
}) {
  const host = useRef(null);
  const hotspotLayer = useRef(null);
  const view = useRef(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setState("error");
      return;
    }
    const container = host.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#1a2b26");
    const camera = new THREE.PerspectiveCamera(68, 1, 0.001, 20);
    const horizontal = -0.01 * Math.cos(initialPitch);
    camera.position.set(
      horizontal * Math.cos(initialHeading),
      -0.01 * Math.sin(initialPitch),
      horizontal * Math.sin(initialHeading),
    );
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "全景，拖动或用方向键环顾");
    container.appendChild(canvas);
    const controls = new OrbitControls(camera, canvas);
    controls.enableZoom = false;
    controls.enablePan = false;
    // 让画面保留可用的上下视野，避开生图在天顶和脚下极点的纹理扭曲。
    controls.minPolarAngle = Math.PI / 2 - pitchLimit;
    controls.maxPolarAngle = Math.PI / 2 + pitchLimit;
    controls.rotateSpeed = -0.4;
    controls.update();
    controls.saveState();
    const material = new THREE.ShaderMaterial({
      ...panoramaShader,
      uniforms: {
        inverseProjection: { value: camera.projectionMatrixInverse },
        viewToWorld: { value: camera.matrixWorld },
        panorama: { value: null },
        blendWidth: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    screen.frustumCulled = false;
    screen.visible = false;
    scene.add(screen);
    const point = new THREE.Vector3();
    let hotspots = [];
    let viewportWidth = 0;
    let viewportHeight = 0;
    const draw = () => {
      renderer.render(scene, camera);
      const placed = [];
      for (const { button, direction, radius } of hotspots) {
        point.copy(camera.position).add(direction).project(camera);
        button.hidden =
          !screen.visible ||
          !viewportWidth ||
          point.z < -1 ||
          point.z > 1 ||
          Math.abs(point.x) > 0.78 ||
          Math.abs(point.y) > 0.84;
        if (button.hidden) continue;
        const x = THREE.MathUtils.clamp(
          ((point.x + 1) * viewportWidth) / 2,
          radius + 6,
          viewportWidth - radius - 6,
        );
        const center = ((1 - point.y) * viewportHeight) / 2;
        const y = [0, -42, 42, -84, 84]
          .map((shift) => center + shift)
          .find(
            (value) =>
              value >= 24 &&
              value <= viewportHeight - 24 &&
              !placed.some(
                (other) =>
                  Math.abs(x - other.x) < radius + other.radius + 6 &&
                  Math.abs(value - other.y) < 39,
              ),
          );
        if (y == null) {
          button.hidden = true;
          continue;
        }
        placed.push({ x, y, radius });
        button.style.left = `${x}px`;
        button.style.top = `${y}px`;
      }
    };
    view.current = {
      screen,
      draw,
      reset: () => controls.reset(),
      setDoors(doors) {
        hotspots = doors.map(({ yaw, pitch, name }, index) => ({
          button: hotspotLayer.current.children[index],
          radius: 21 + Math.min(12, Array.from(name).length) * 6,
          direction: new THREE.Vector3(
            Math.cos(pitch) * Math.cos(yaw),
            Math.sin(pitch),
            Math.cos(pitch) * Math.sin(yaw),
          ),
        }));
        draw();
      },
    };
    const resize = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = container;
      if (!w || !h) return;
      viewportWidth = w;
      viewportHeight = h;
      camera.aspect = w / h;
      // 全宽浏览时限制水平视角，避免画面边缘的门框和家具被拉宽。
      camera.fov = Math.min(
        68,
        THREE.MathUtils.radToDeg(
          2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(50)) / camera.aspect),
        ),
      );
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(w, h, false);
      draw();
    });
    resize.observe(container);
    controls.addEventListener("change", draw);
    const directions = {
      ArrowLeft: [0.12, 0],
      ArrowRight: [-0.12, 0],
      ArrowUp: [0, 0.1],
      ArrowDown: [0, -0.1],
    };
    const keyboard = (event) => {
      if (!Object.hasOwn(directions, event.key)) return;
      event.preventDefault();
      const [azimuth, elevation] = directions[event.key];
      const position = new THREE.Spherical().setFromVector3(camera.position);
      position.theta += azimuth;
      position.phi = THREE.MathUtils.clamp(
        position.phi + elevation,
        controls.minPolarAngle,
        controls.maxPolarAngle,
      );
      camera.position.setFromSpherical(position);
      controls.update();
    };
    canvas.addEventListener("keydown", keyboard);
    return () => {
      view.current = null;
      resize.disconnect();
      canvas.removeEventListener("keydown", keyboard);
      controls.dispose();
      material.uniforms.panorama.value?.dispose();
      material.dispose();
      screen.geometry.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [initialHeading, initialPitch]);

  useEffect(() => {
    const current = view.current;
    if (!current) return;
    let active = true;
    setState("loading");
    new THREE.TextureLoader()
      .loadAsync(src)
      .then((image) => {
        if (!active) {
          image.dispose();
          return;
        }
        image.colorSpace = THREE.SRGBColorSpace;
        image.wrapS = THREE.RepeatWrapping;
        // 经度在接缝处从 1 跳到 0，禁用跨接缝的隐式 mipmap 选级。
        image.generateMipmaps = false;
        image.minFilter = THREE.LinearFilter;
        const uniforms = current.screen.material.uniforms;
        uniforms.panorama.value?.dispose();
        uniforms.panorama.value = image;
        uniforms.blendWidth.value = smoothSeam ? seamWidth : 0;
        current.screen.visible = true;
        current.draw();
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [src, initialHeading, initialPitch, smoothSeam]);

  useEffect(() => {
    view.current?.setDoors(doors);
  }, [doors, initialHeading, initialPitch]);

  return (
    <div className="roam-panorama" role="region" aria-label={label}>
      <div className="roam-canvas" ref={host} />
      <div
        className="roam-hotspots"
        ref={hotspotLayer}
        hidden={state !== "ready"}
      >
        {doors.map((door) => (
          <button
            type="button"
            key={door.id}
            hidden
            onClick={() => onRoomChange?.(door.roomId)}
          >
            <ArrowUpRight size={15} /> <span>{door.name}</span>
          </button>
        ))}
      </div>
      {state === "ready" && (
        <button
          type="button"
          className="roam-reset-view"
          aria-label="回到初始视角"
          title="回到初始视角"
          onClick={() => view.current?.reset()}
        >
          <RotateCcw size={17} />
        </button>
      )}
      {state !== "ready" && (
        <p role="status" className="roam-view-message">
          {state === "loading"
            ? "正在打开全景…"
            : "全景加载失败，请切换视图重试。"}
        </p>
      )}
    </div>
  );
}
