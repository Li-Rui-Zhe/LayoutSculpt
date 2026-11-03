import * as THREE from "three";
import { buildTour } from "./tourModel.js";
import { cameraState, restoreCamera } from "./cameraTools.js";
import { setRoomIsolation } from "./roomIsolation.js";
import {
  buildWalkObstacles,
  buildWalkRegions,
  walkPathError,
  dragExceeded,
} from "./tourWalking.js";
import { createWalkRouter, routePosition } from "./tourRouting.js";
import { insideRoom } from "./tourGeometry.js";
import { MOVE_KEYS, movementDelta, moveOnFloor } from "./tourMovement.js";
import { TourFurniture } from "./TourFurniture.js";
import { TourCeiling } from "./TourCeiling.js";
import { arrivalYaw, nearbyPortal } from "./tourPresentation.js";
import { RoomViews, recommendedRooms } from "./RoomViews.js";

// 房内点击地面移动；跨房间使用已确认的门户，地图保留快捷切换。
export class RoomTour {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.moveInputs = new Map();
  }
  start(preferred) {
    if (this.active) return true;
    const s = this.scene;
    if (!s.model) return false;
    this.data = buildTour(s.model);
    this.walkCollision = new Map();
    this.walkRegions = new Map();
    this.walkRouters = new Map();
    const room =
      this.data.available.find(
        (r) => r.id === preferred && this.arrivalFor(r),
      ) ||
      this.data.available.find(
        (r) => /客厅|客餐|起居/.test(r.name) && this.arrivalFor(r),
      ) ||
      this.data.available.find((r) => this.arrivalFor(r));
    if (!room) return false;
    this.roomViews = new RoomViews(
      s.model,
      this.data,
      (r, point) =>
        !walkPathError(point, point, r.polygon, this.obstaclesFor(r)),
    );
    this.recommendations = recommendedRooms(this.data.available);
    this.saved = cameraState(s);
    this.savedClip = { near: s.camera.near, far: s.camera.far };
    this.savedSettings = { ...s.viewSettings };
    setRoomIsolation(s, null);
    s.reset(false);
    this.active = true;
    s.settings(this.savedSettings);
    this.furnitureView = new TourFurniture(s.model);
    this.ceilingView = new TourCeiling(s.scene, s.model);
    s.controls.enabled = false;
    s.interactionQuality?.restore();
    this.tourClip = {
      camera: s.camera,
      near: s.camera.near,
      far: s.camera.far,
    };
    s.camera.fov = 68;
    s.camera.near = 0.035;
    s.camera.far = Math.max(s.camera.far, 80);
    s.camera.zoom = 1;
    s.camera.updateProjectionMatrix();
    this.layer = document.createElement("div");
    this.layer.className = "tour-hotspots";
    s.host.appendChild(this.layer);
    this.canvas = s.renderer.domElement;
    this.previousTabIndex = this.canvas.getAttribute("tabindex");
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute(
      "aria-label",
      "室内漫游，WASD 或屏幕方向按钮移动，点击地面前往落点，拖动或方向键环顾，Escape 返回鸟瞰",
    );
    this.events = new AbortController();
    const listen = (type, fn, extra = {}) =>
      this.canvas.addEventListener(type, fn, {
        signal: this.events.signal,
        ...extra,
      });
    listen("pointerdown", (e) => {
      if (e.isPrimary === false) {
        if (this.drag) this.drag.moved = true;
        return;
      }
      if (e.button !== 0 || this.drag) return;
      this.cancelWalking();
      this.canvas.focus({ preventScroll: true });
      this.drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        start: { x: e.clientX, y: e.clientY },
        moved: false,
      };
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = "grabbing";
    });
    listen("pointermove", (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const moved = dragExceeded(this.drag.start, {
        x: e.clientX,
        y: e.clientY,
      });
      if (moved) this.drag.moved = true;
      if (this.drag.moved)
        this.turnFromDrag(e.clientX - this.drag.x, e.clientY - this.drag.y);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    });
    const release = (e) => {
      if (this.drag?.id !== e.pointerId) return;
      const click =
        e.type === "pointerup" &&
        !this.drag.moved &&
        !dragExceeded(this.drag.start, { x: e.clientX, y: e.clientY });
      this.drag = null;
      if (this.canvas.hasPointerCapture(e.pointerId))
        this.canvas.releasePointerCapture(e.pointerId);
      this.canvas.style.cursor = "grab";
      if (click) this.clickGround(e.clientX, e.clientY);
    };
    listen("pointerup", release);
    listen("pointercancel", release);
    listen("lostpointercapture", release);
    listen(
      "wheel",
      (e) => {
        e.preventDefault();
        s.camera.fov = THREE.MathUtils.clamp(
          s.camera.fov + Math.sign(e.deltaY) * 3,
          45,
          85,
        );
        s.camera.updateProjectionMatrix();
        this.look();
      },
      { passive: false },
    );
    const keydown = (e) => {
      if (
        e.isComposing ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target !== this.canvas &&
          e.target !== document.body &&
          !e.target?.closest?.(".room-tour-overlay")) ||
        e.target?.closest?.("input, textarea, select, [contenteditable=true]")
      )
        return;
      if (MOVE_KEYS[e.code]) {
        e.preventDefault();
        this.fastMove = e.shiftKey;
        this.setMoveInput(`key:${e.code}`, MOVE_KEYS[e.code], true);
      } else if (e.key === "Shift") this.fastMove = true;
      else if (this.turnFromKey(e.key)) e.preventDefault();
    };
    const clearMovement = () => this.clearMoveInputs();
    const eventOptions = { signal: this.events.signal };
    document.addEventListener("keydown", keydown, eventOptions);
    window.addEventListener(
      "keyup",
      (e) => {
        if (MOVE_KEYS[e.code])
          this.setMoveInput(`key:${e.code}`, MOVE_KEYS[e.code], false);
        if (e.key === "Shift") this.fastMove = false;
      },
      eventOptions,
    );
    window.addEventListener("blur", clearMovement, eventOptions);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.clearMoveInputs();
      },
      eventOptions,
    );
    document.addEventListener(
      "focusin",
      (e) => {
        if (e.target !== this.canvas) this.clearMoveInputs();
      },
      eventOptions,
    );
    this.occluders = [];
    s.model.traverse((o) => {
      if (o.isMesh && (o.userData.wall_id || o.userData.architecture_network))
        this.occluders.push(o);
    });
    this.ray = new THREE.Raycaster();
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.2, 48),
      new THREE.MeshBasicMaterial({
        color: 0xb2db9e,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    s.scene.add(this.marker);
    this.move(room.id, null, false, true);
    this.canvas.focus({ preventScroll: true });
    return true;
  }
  obstaclesFor(room) {
    if (!this.walkCollision.has(room.id))
      this.walkCollision.set(
        room.id,
        buildWalkObstacles(this.scene.model, room.floor),
      );
    return this.walkCollision.get(room.id);
  }
  arrivalFor(room) {
    return room.stations.find(
      (p) => !walkPathError(p, p, room.polygon, this.obstaclesFor(room)),
    );
  }
  regionsFor(room) {
    this.walkRegions ||= new Map();
    if (!this.walkRegions.has(room.id))
      this.walkRegions.set(
        room.id,
        buildWalkRegions(this.data.rooms, this.data.portals, room),
      );
    return this.walkRegions.get(room.id);
  }
  setMoveInput(source, direction, pressed) {
    if (
      !this.active ||
      !["forward", "backward", "left", "right"].includes(direction)
    )
      return;
    if (!pressed) {
      if (this.moveInputs.delete(source) && !this.moveInputs.size) {
        // 很快的轻点可能短于一帧，也给出一小步反馈；失焦清理不补步。
        if ((this.manualDistance ?? 0) < 0.1)
          this.applyMovement(
            movementDelta(
              new Set([direction]),
              this.yaw,
              0.12 - (this.manualDistance ?? 0),
            ),
          );
        this.manualTime = null;
        this.manualBlocked = false;
        this.publish();
      }
      return;
    }
    if (this.moveInputs.has(source)) return;
    const starting = !this.moveInputs.size;
    this.cancelWalking();
    this.fade?.remove();
    this.fade = null;
    if (this.marker) this.marker.visible = false;
    this.moveInputs.set(source, direction);
    if (starting) {
      this.manualTime = performance.now();
      this.manualDistance = 0;
      this.manualBlocked = false;
      this.publish("", true);
    }
  }
  clearMoveInputs() {
    const wasMoving = this.moveInputs.size > 0;
    this.moveInputs.clear();
    this.fastMove = false;
    this.manualTime = null;
    this.manualBlocked = false;
    if (wasMoving) this.publish();
  }
  stepMove(direction) {
    if (!this.active) return;
    this.clearMoveInputs();
    this.cancelWalking();
    this.applyMovement(movementDelta(new Set([direction]), this.yaw, 0.3));
    this.publish(this.manualBlocked ? "前方不可通行，请换个方向。" : "");
  }
  applyMovement(delta) {
    if (!delta.x && !delta.y) return;
    const camera = this.scene.camera;
    const from = { x: camera.position.x, y: camera.position.z };
    const next = moveOnFloor(
      from,
      delta,
      this.regionsFor(this.room),
      this.obstaclesFor(this.room),
    );
    const blocked = Math.hypot(next.x - from.x, next.y - from.y) < 1e-6;
    if (blocked) {
      if (!this.manualBlocked) this.publish("前方不可通行，请换个方向。", true);
    } else {
      this.manualDistance =
        (this.manualDistance ?? 0) +
        Math.hypot(next.x - from.x, next.y - from.y);
      camera.position.x = next.x;
      camera.position.z = next.y;
      const room = this.data.rooms.find(
        (r) =>
          Math.abs(r.floor - this.room.floor) < 0.04 &&
          insideRoom(next, r.polygon),
      );
      const changed = room && room.id !== this.room.id;
      if (changed) {
        this.room = room;
        this.renderHotspots();
      }
      this.look();
      if (changed || this.manualBlocked)
        this.publish("", !!this.moveInputs.size);
    }
    this.manualBlocked = blocked;
  }
  publish(message = "", moving = false) {
    if (!this.active || !this.room) return;
    const p = this.scene.camera.position;
    this.scene.callbacks.onTour?.({
      room: this.room.id,
      position: { x: p.x, y: p.z },
      rooms: this.data.rooms,
      portals: this.data.portals,
      message,
      moving,
      manual: this.moveInputs.size > 0,
      recommendations: this.recommendations,
    });
    this.messageUntil = message ? performance.now() + 3000 : 0;
  }
  cancelWalking() {
    if (!this.walking) return;
    this.walking = null;
    const position = this.scene.camera.position;
    const room = this.data.rooms.find(
      (r) =>
        Math.abs(r.floor - this.room.floor) < 0.04 &&
        insideRoom({ x: position.x, y: position.z }, r.polygon),
    );
    if (room && room.id !== this.room.id) {
      this.room = room;
      this.renderHotspots();
    }
    this.markerUntil = performance.now() + 250;
    this.publish();
  }
  clickGround(clientX, clientY) {
    const s = this.scene,
      rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((clientY - rect.top) / rect.height) * 2,
      ),
      s.camera,
    );
    this.ray.far = s.camera.far;
    const hit = this.ray.intersectObject(s.model, true).find((hit) => {
      if (this.furnitureView?.ignoresHit(hit.object)) return false;
      for (let o = hit.object; o; o = o.parent) if (!o.visible) return false;
      const m = Array.isArray(hit.object.material)
        ? hit.object.material[hit.face?.materialIndex || 0]
        : hit.object.material;
      return m?.visible !== false && !(m?.transparent && m.opacity === 0);
    });
    if (!hit) {
      this.publish("点击房间里的空地，就能移动过去。");
      return;
    }
    const normal = hit.face?.normal
      .clone()
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
      .normalize();
    const point = { x: hit.point.x, y: hit.point.z, surface: hit.point.y };
    const room = this.data.rooms.find(
      (r) =>
        Math.abs(hit.point.y - r.floor) < 0.13 && insideRoom(point, r.polygon),
    );
    // 部分导入地面是反向法线的双面网格；朝向不能决定地面能否行走。
    if (!room || !normal || Math.abs(normal.y) < 0.7) {
      this.publish("请点击地面空地；移动途中可以穿过家具。");
      return;
    }
    this.walkTo(point, room);
  }
  showDestination(point, floor, valid) {
    this.marker.position.set(
      point.x,
      Math.max(floor, point.surface ?? floor) + 0.025,
      point.y,
    );
    this.marker.material.color.setHex(valid ? 0xb2db9e : 0xeab580);
    this.marker.material.opacity = 0.9;
    this.marker.visible = true;
    this.markerUntil = performance.now() + 1300;
    this.scene.dirty = true;
  }
  walkTo(point, targetRoom = this.room) {
    if (!this.active || !this.room) return false;
    this.clearMoveInputs();
    const s = this.scene,
      from = { x: s.camera.position.x, y: s.camera.position.z };
    this.regionsFor(this.room);
    this.walkRouters ||= new Map();
    if (!this.walkRouters.has(this.room.id))
      this.walkRouters.set(
        this.room.id,
        createWalkRouter(
          this.walkRegions.get(this.room.id),
          this.obstaclesFor(this.room),
        ),
      );
    const route = this.walkRouters.get(this.room.id)(from, point);
    const error = route.error;
    this.showDestination(point, this.room.floor, !error);
    if (error) {
      this.publish(error);
      return false;
    }
    const distance = Math.hypot(point.x - from.x, point.y - from.y);
    if (distance < 0.12) {
      this.publish("已经在这里了。");
      return true;
    }
    this.fade?.remove();
    this.fade = null;
    const to = new THREE.Vector3(point.x, targetRoom.floor + 1.55, point.y);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      s.camera.position.copy(to);
      if (this.room.id !== targetRoom.id) {
        this.room = targetRoom;
        this.renderHotspots();
      }
      this.look();
      this.publish();
    } else {
      const points = route.points.map(
        (p) => new THREE.Vector3(p.x, targetRoom.floor + 1.55, p.y),
      );
      points[0].copy(s.camera.position);
      const length = points
        .slice(1)
        .reduce((sum, p, i) => sum + p.distanceTo(points[i]), 0);
      this.walking = {
        room: targetRoom,
        from: s.camera.position.clone(),
        to,
        points,
        started: performance.now(),
        duration: Math.max(320, (length / 2) * 1000),
      };
      this.publish(points.length > 2 ? "正在绕开障碍，前往落点…" : "", true);
    }
    return true;
  }
  turnFromDrag(dx, dy) {
    // yaw 正值向右，屏幕 y 正值向下；鼠标和触屏都按拖动方向转头。
    this.turn(dx * 0.004, -dy * 0.003);
  }
  turnFromKey(key) {
    const delta = {
      ArrowLeft: [-0.12, 0],
      ArrowRight: [0.12, 0],
      ArrowUp: [0, 0.1],
      ArrowDown: [0, -0.1],
    }[key];
    if (!delta) return false;
    this.turn(...delta);
    return true;
  }
  turn(horizontal, vertical) {
    this.yaw += horizontal;
    this.pitch = THREE.MathUtils.clamp(this.pitch + vertical, -1.05, 1.05);
    this.look();
  }
  look() {
    const s = this.scene;
    const direction = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    s.camera.lookAt(s.camera.position.clone().add(direction));
    s.camera.updateMatrixWorld();
    s.dirty = true;
    this.needsProjection = true;
  }
  move(id, portal = null, animate = true, recommended = false) {
    if (!this.active) return false;
    this.clearMoveInputs();
    const room = this.data.available.find((r) => r.id === id);
    const view = recommended && room ? this.roomViews?.get(room) : null;
    const station = view?.station || (room && this.arrivalFor(room));
    if (!station) {
      this.publish("这个房间暂时没有合适的落脚位置。");
      return false;
    }
    this.cancelWalking();
    if (this.marker) this.marker.visible = false;
    const s = this.scene;
    // 保留上一帧交叉淡化；不给用户展示穿墙镜头，不下载或重建模型。
    this.fade?.remove();
    this.fade = null;
    if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      try {
        const image = document.createElement("canvas");
        const source = s.renderer.domElement;
        const ratio = Math.min(1, 1400 / source.width);
        image.width = Math.round(source.width * ratio);
        image.height = Math.round(source.height * ratio);
        image
          .getContext("2d")
          .drawImage(source, 0, 0, image.width, image.height);
        image.setAttribute("aria-hidden", "true");
        image.className = "tour-frame-fade";
        s.host.appendChild(image);
        this.fade = image;
        this.fadeUntil = performance.now() + 420;
      } catch {
        /* 截图不可用时保持即时导航。 */
      }
    }
    if (!this.room || this.room.id !== id || portal || recommended)
      this.yaw = arrivalYaw(
        room,
        station,
        this.data,
        this.furnitureView?.targets(room.id),
      );
    if (view) this.yaw = view.yaw;
    this.pitch = view?.pitch ?? -0.08;
    if (recommended) {
      s.camera.fov = view?.fov ?? 68;
      s.camera.updateProjectionMatrix();
    }
    this.room = room;
    s.camera.position.set(station.x, station.height, station.y);
    this.look();
    this.renderHotspots();
    this.publish(
      recommended && !view
        ? "已进入房间，可拖动环顾；当前没有无遮挡的推荐角度。"
        : "",
    );
    return true;
  }
  renderHotspots() {
    this.layer.replaceChildren();
    this.hotspots = [];
    const add = (label, point, run, kind) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tour-hotspot ${kind}`;
      button.textContent = `${label} ›`;
      button.hidden = true;
      button.setAttribute("aria-label", `快速前往${label}`);
      button.title = `可直接走过门口，也可点击快速前往${label}`;
      button.addEventListener("click", () => {
        run();
        this.canvas.focus({ preventScroll: true });
      });
      this.layer.appendChild(button);
      this.hotspots.push({ button, point });
    };
    for (const p of this.data.portals.filter((p) =>
      p.rooms.includes(this.room.id),
    )) {
      const target = this.data.available.find(
        (r) => r.id === p.rooms.find((id) => id !== this.room.id),
      );
      if (!target) continue;
      add(
        target.name,
        new THREE.Vector3(p.x, p.height, p.y),
        () => this.move(target.id, p),
        "door",
      );
    }
    this.needsProjection = true;
  }
  update(now) {
    if (!this.active) return;
    if (this.moveInputs.size) {
      const dt = Math.max(
        0,
        Math.min(0.05, (now - (this.manualTime ?? now)) / 1000),
      );
      this.manualTime = now;
      this.applyMovement(
        movementDelta(
          new Set(this.moveInputs.values()),
          this.yaw,
          dt * (this.fastMove ? 2.8 : 1.5),
        ),
      );
    }
    if (this.walking) {
      const step = this.walking,
        t =
          now >= step.started + step.duration
            ? 1
            : Math.max(0, (now - step.started) / step.duration);
      this.scene.camera.position.copy(routePosition(step.points, t));
      this.look();
      if (t === 1) {
        if (this.room.id !== step.room.id) {
          this.room = step.room;
          this.renderHotspots();
        }
        this.walking = null;
        this.markerUntil = now + 450;
        this.publish();
      }
    }
    if (this.marker?.visible) {
      if (!this.walking && now >= this.markerUntil) this.marker.visible = false;
      else {
        this.marker.scale.setScalar(1 + 0.05 * Math.sin(now * 0.008));
        this.marker.material.opacity = this.walking
          ? 0.75
          : Math.max(0, Math.min(0.85, (this.markerUntil - now) / 450));
      }
      this.scene.dirty = true;
    }
    if (this.messageUntil && now >= this.messageUntil)
      this.publish("", !!this.walking || !!this.moveInputs.size);
    if (this.fade && now >= this.fadeUntil) {
      this.fade.remove();
      this.fade = null;
    }
    if (this.furnitureView?.update(this.scene.camera, now))
      this.scene.dirty = true;
    if (!this.needsProjection) return;
    this.needsProjection = false;
    const s = this.scene;
    for (const { button, point } of this.hotspots) {
      const p = point.clone().project(s.camera);
      let visible =
        nearbyPortal(
          Math.hypot(
            point.x - s.camera.position.x,
            point.z - s.camera.position.z,
          ),
          !button.hidden,
        ) &&
        p.z > -1 &&
        p.z < 1 &&
        Math.abs(p.x) < 0.94 &&
        Math.abs(p.y) < 0.82;
      if (visible) {
        const direction = point.clone().sub(s.camera.position);
        this.ray.set(s.camera.position, direction.clone().normalize());
        this.ray.far = Math.max(0, direction.length() - 0.35);
        visible = !this.ray
          .intersectObjects(this.occluders, false)
          .some((hit) => hit.object.visible);
      }
      if (!visible && document.activeElement === button)
        this.canvas.focus({ preventScroll: true });
      button.hidden = !visible;
      if (visible) {
        button.style.left = `${(p.x + 1) * 50}%`;
        button.style.top = `${(1 - p.y) * 50}%`;
      }
    }
  }
  stop() {
    if (!this.active) return;
    this.active = false;
    this.clearMoveInputs();
    const s = this.scene;
    this.events.abort();
    if (this.drag && this.canvas.hasPointerCapture(this.drag.id))
      this.canvas.releasePointerCapture(this.drag.id);
    this.drag = null;
    this.walking = null;
    this.walkCollision?.clear();
    this.walkRegions?.clear();
    this.walkRouters?.clear();
    this.roomViews = null;
    this.recommendations = [];
    this.furnitureView?.dispose();
    this.furnitureView = null;
    this.ceilingView?.dispose();
    this.ceilingView = null;
    this.marker?.removeFromParent();
    this.marker?.geometry.dispose();
    this.marker?.material.dispose();
    this.marker = null;
    this.room = null;
    this.layer.remove();
    this.fade?.remove();
    this.fade = null;
    this.canvas.style.cursor = "grab";
    this.canvas.removeAttribute("aria-label");
    if (this.previousTabIndex == null) this.canvas.removeAttribute("tabindex");
    else this.canvas.setAttribute("tabindex", this.previousTabIndex);
    s.settings(s.viewSettings || this.savedSettings);
    if (this.tourClip) {
      const { camera, near, far } = this.tourClip;
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
      this.tourClip = null;
    }
    restoreCamera(s, this.saved);
    if (this.savedClip) {
      s.camera.near = this.savedClip.near;
      s.camera.far = this.savedClip.far;
      s.camera.updateProjectionMatrix();
    }
    s.controls.enabled = s.active && !!s.model;
    s.callbacks.onTour?.(null);
  }
}
