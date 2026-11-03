import {
  forwardRef,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { useCustomTextures } from "../materials/customTextures.js";
import { StudioScene } from "../viewer/StudioScene.js";
import { useViewportRuntime } from "../viewer/ViewportRuntime.jsx";
import ContextRecovery from "../viewer/ContextRecovery.jsx";

export default forwardRef(function Viewport(
  {
    url,
    state,
    settings,
    active = true,
    onLoading,
    onError,
    onZoom,
    onThumbnails,
    onView,
    onRooms,
    onTour,
  },
  ref,
) {
  const customVersion = useCustomTextures();
  const host = useRef(null),
    engine = useRef(null),
    callbacks = useRef({});
  const runtime = useViewportRuntime();
  callbacks.current = {
    onLoading,
    onError,
    onZoom,
    onThumbnails,
    onView,
    onRooms,
    onTour,
  };
  useLayoutEffect(() => {
    try {
      const handlers = Object.fromEntries(
        Object.keys(callbacks.current).map((key) => [
          key,
          (...args) => callbacks.current[key]?.(...args),
        ]),
      );
      if (!runtime.scene)
        runtime.scene = new StudioScene(host.current, handlers);
      engine.current = runtime.scene;
      engine.current.attach(host.current, handlers);
    } catch (error) {
      callbacks.current.onLoading?.(false);
      callbacks.current.onError?.(`无法初始化三维视图：${error.message}`);
    }
    return () => {
      engine.current?.detach();
      engine.current = null;
    };
  }, [runtime]);
  useLayoutEffect(() => {
    engine.current?.apply(state);
  }, [state, customVersion]);
  useLayoutEffect(() => {
    engine.current?.settings(settings);
  }, [settings]);
  useLayoutEffect(() => {
    engine.current?.load(url);
  }, [url]);
  useLayoutEffect(() => {
    engine.current?.setActive(active);
  }, [active]);
  useImperativeHandle(
    ref,
    () => ({
      cameraState: () => engine.current?.cameraState(),
      startTour: (room) => engine.current?.startTour(room),
      stopTour: () => engine.current?.stopTour(),
      tourRoom: (id) => engine.current?.tourRoom(id),
      recommendedRoom: (id) => engine.current?.recommendedRoom(id),
      tourMove: (direction, pressed) =>
        engine.current?.tourMove(direction, pressed),
      tourStep: (direction) => engine.current?.tourStep(direction),
      restoreCamera: (value) => engine.current?.restoreCamera(value),
      focusRoom: (id, inside) => engine.current?.focusRoom(id, inside),
      isolateRoom: (id) => engine.current?.isolateRoom(id),
      reset: (top) => engine.current?.reset(top),
      zoom: (factor) => engine.current?.zoom(factor),
      snapshot: () => engine.current?.snapshot(),
      // 导出持有当前场景，页面切换后不可操作复用给其他项目的渲染器。
      captureSession: () => {
        const scene = engine.current,
          revision = scene?.revision;
        if (!scene) return null;
        const isCurrent = () =>
          engine.current === scene &&
          scene.revision === revision &&
          !scene.disposed;
        return {
          isCurrent,
          cameraState: () => (isCurrent() ? scene.cameraState() : null),
          restoreCamera: (value) => isCurrent() && scene.restoreCamera(value),
          isolateRoom: (id) => isCurrent() && scene.isolateRoom(id),
          reset: (top) => isCurrent() && scene.reset(top),
          focusRoom: (id, inside) => isCurrent() && scene.focusRoom(id, inside),
          snapshot: () =>
            isCurrent()
              ? scene.snapshot({
                  maxDimension: 1800,
                  type: "image/jpeg",
                  quality: 0.94,
                })
              : null,
        };
      },
    }),
    [],
  );
  return (
    <>
      <div ref={host} id="viewport" aria-label="可旋转的三维户型模型" />
      <ContextRecovery
        target={() => engine.current?.renderer.domElement}
        onRestored={() => engine.current?.recoverContext()}
      />
    </>
  );
});
