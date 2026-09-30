import {
  forwardRef,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { StudioScene } from "../viewer/StudioScene.js";
import { useViewportRuntime } from "../viewer/ViewportRuntime.jsx";

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
  },
  ref,
) {
  const host = useRef(null),
    engine = useRef(null),
    callbacks = useRef({});
  const runtime = useViewportRuntime();
  callbacks.current = { onLoading, onError, onZoom, onThumbnails, onView };
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
  }, [state]);
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
      reset: (top) => engine.current?.reset(top),
      zoom: (factor) => engine.current?.zoom(factor),
      snapshot: () => engine.current?.snapshot(),
    }),
    [],
  );
  return <div ref={host} id="viewport" aria-label="可旋转的三维户型模型" />;
});
