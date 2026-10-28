import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { boundaryFrameParts, isGlassBoundary } from "../editor/balcony.js";
import { surfaceProfile } from "../materials/surfaces.js";
import { openingParts } from "../editor/openingVisuals.js";

// Catalogue and inspector share the same metre-based wall dimensions.
export default function ArchitecturePreview({
  type = "wall",
  height = 2.7,
  thickness = 0.16,
  sillHeight = 0,
  material,
  opening,
  interactive = false,
  label = "建筑构件三维预览",
}) {
  const host = useRef(null);
  const [error, setError] = useState("");
  const [thumbnail, setThumbnail] = useState("");
  const openingSignature = JSON.stringify(opening || null);
  useEffect(() => {
    const container = host.current;
    let renderer,
      controls,
      observer,
      disposed = false;
    const scene = new THREE.Scene();
    const textures = new Set();
    const safeHeight = Math.max(0.3, Math.min(4.5, Number(height) || 0.3));
    const safeThickness = Math.max(
      0.06,
      Math.min(0.6, Number(thickness) || 0.06),
    );
    const sill = Math.max(0, Math.min(safeHeight, Number(sillHeight) || 0));
    try {
      setError("");
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(
        Math.min(devicePixelRatio || 1, interactive ? 2 : 1),
      );
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.25;
      renderer.domElement.setAttribute("aria-hidden", "true");
      container.append(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
      const displayHeight = opening
        ? Math.max(2.7, (Number(opening.bottom) || 0) + safeHeight + 0.18)
        : safeHeight;
      const target = new THREE.Vector3(0, displayHeight / 2, 0);
      const draw = () => {
        if (!disposed) renderer.render(scene, camera);
      };
      const profile = material ? surfaceProfile(material, "walls") : null;
      const solid = new THREE.MeshStandardMaterial({
        color: profile?.color || "#e0dcd1",
        roughness: profile?.roughness ?? 0.8,
      });
      const glass = new THREE.MeshStandardMaterial({
        color: "#b7dbdf",
        transparent: true,
        opacity: 0.22,
        roughness: 0.12,
        metalness: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const frame = new THREE.MeshStandardMaterial({
        color: "#6b726c",
        roughness: 0.3,
        metalness: 0.65,
      });
      const openingWidth = Math.max(
        0.1,
        Math.min(60, Number(opening?.width) || 0.1),
      );
      const width = opening ? openingWidth + 0.5 : 2.4;
      const wall = {
        boundary_type: type,
        height: safeHeight,
        sill_height: sill,
        start: { x: 0, y: 0 },
        end: { x: width, y: 0 },
      };
      const box = (w, h, d, x, y, z, mat) => {
        if (h <= 0 || w <= 0) return;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(x, y, z);
        scene.add(mesh);
        return mesh;
      };
      if (opening) {
        const value = {
          ...opening,
          width: openingWidth,
          height: safeHeight,
          bottom: Math.max(0, Number(opening.bottom) || 0),
        };
        const y = value.bottom,
          top = y + safeHeight;
        box(
          0.25,
          displayHeight,
          safeThickness,
          -width / 2 + 0.125,
          displayHeight / 2,
          0,
          solid,
        );
        box(
          0.25,
          displayHeight,
          safeThickness,
          width / 2 - 0.125,
          displayHeight / 2,
          0,
          solid,
        );
        box(openingWidth, y, safeThickness, 0, y / 2, 0, solid);
        box(
          openingWidth,
          displayHeight - top,
          safeThickness,
          0,
          (displayHeight + top) / 2,
          0,
          solid,
        );
        const openingMaterials = {
          frame: new THREE.MeshStandardMaterial({
            color: "#e2e2da",
            roughness: 0.5,
          }),
          wood: new THREE.MeshStandardMaterial({
            color: "#a98b62",
            roughness: 0.65,
          }),
          glass,
          frosted: new THREE.MeshStandardMaterial({
            color: "#d7e5e5",
            transparent: true,
            opacity: 0.65,
            roughness: 0.65,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
          metal: frame,
        };
        for (const part of openingParts(value, safeThickness)) {
          const mesh = box(
            ...part.size,
            part.position[0] - openingWidth / 2,
            part.position[1],
            part.position[2],
            openingMaterials[part.material],
          );
          if (mesh) mesh.rotation.y = part.angle;
        }
      } else if (isGlassBoundary(wall)) {
        box(width, sill, safeThickness, 0, sill / 2, 0, solid);
        box(
          width,
          safeHeight - sill,
          safeThickness,
          0,
          (safeHeight + sill) / 2,
          0,
          glass,
        );
        for (const [a, b, low, high] of boundaryFrameParts(wall))
          box(
            b - a,
            high - low,
            safeThickness + 0.008,
            (a + b) / 2 - width / 2,
            (low + high) / 2,
            0,
            frame,
          );
      } else box(width, safeHeight, safeThickness, 0, safeHeight / 2, 0, solid);
      box(
        width + 0.3,
        0.06,
        0.65,
        0,
        -0.03,
        0,
        new THREE.MeshStandardMaterial({ color: "#c4c7bb", roughness: 0.9 }),
      );
      scene.add(new THREE.HemisphereLight(0xffffff, 0xb2b7a4, 2.6));
      const light = new THREE.DirectionalLight(0xfff6e8, 3);
      light.position.set(3, 6, 5);
      scene.add(light);
      const fill = new THREE.DirectionalLight(0xe8f3ff, 1);
      fill.position.set(-4, 2, -3);
      scene.add(fill);
      const resize = () => {
        if (disposed) return;
        const w = Math.max(1, container.clientWidth),
          h = Math.max(1, container.clientHeight);
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        const vertical = displayHeight + 0.5,
          horizontal = width + 0.65;
        const distance =
          (Math.max(vertical, horizontal / camera.aspect) /
            (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) *
          1.35;
        camera.position
          .copy(target)
          .add(
            new THREE.Vector3(0.95, 0.38, 1.7)
              .normalize()
              .multiplyScalar(distance),
          );
        camera.lookAt(target);
        if (controls) {
          controls.target.copy(target);
          controls.update();
        }
        draw();
      };
      if (interactive) {
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enablePan = false;
        controls.enableDamping = false;
        controls.minDistance = 2;
        controls.maxDistance = 30;
        controls.target.copy(target);
        controls.addEventListener("change", draw);
      }
      observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      if (!interactive && !material) {
        setThumbnail(renderer.domElement.toDataURL("image/png"));
        observer.disconnect();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
        disposed = true;
      }
      if (profile?.surface) {
        const prefix = profile.surface.startsWith("texture:")
          ? `/api/materials/custom/${profile.surface.slice(8)}`
          : `/materials/${profile.surface}`;
        const load = (url, normal = false) => {
          const texture = new THREE.TextureLoader().load(
            url,
            (loaded) => {
              if (disposed) {
                loaded.dispose();
                return;
              }
              loaded.wrapS = loaded.wrapT = THREE.RepeatWrapping;
              loaded.repeat.set(width / 2, safeHeight / 2);
              if (!normal) {
                loaded.colorSpace = THREE.SRGBColorSpace;
                solid.map = loaded;
              } else {
                solid.normalMap = loaded;
                solid.normalScale.setScalar(profile.normalStrength || 0.2);
              }
              solid.needsUpdate = true;
              draw();
            },
            undefined,
            () => {},
          );
          textures.add(texture);
        };
        load(
          profile.surface.startsWith("texture:")
            ? `${prefix}.png`
            : `${prefix}_color.png`,
        );
        if (!profile.surface.startsWith("texture:"))
          load(`${prefix}_normal.png`, true);
      }
    } catch {
      setError("三维预览暂不可用，请刷新页面重试。");
    }
    return () => {
      disposed = true;
      observer?.disconnect();
      controls?.dispose();
      const mats = new Set();
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) mats.add(o.material);
      });
      mats.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    };
  }, [
    type,
    height,
    thickness,
    sillHeight,
    material,
    interactive,
    openingSignature,
  ]);
  return (
    <div
      ref={host}
      className={`architecture-preview ${interactive ? "is-interactive" : ""}`}
      role="img"
      aria-label={label}
    >
      {thumbnail && !interactive && (
        <img
          src={thumbnail}
          alt=""
          aria-hidden="true"
          className="architecture-thumbnail"
        />
      )}
      {error ? (
        <span className="architecture-preview-error" role="status">
          {error}
        </span>
      ) : (
        interactive && (
          <span className="architecture-preview-hint">拖动旋转 · 滚轮缩放</span>
        )
      )}
    </div>
  );
}
