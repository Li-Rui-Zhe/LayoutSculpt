import { useEffect, useRef, useState } from "react";
import {
  PAINT_SIZE,
  canvasPoint,
  paintMark,
  readArtwork,
  writeArtwork,
} from "./paintTools.js";

const loadImage = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(Error("底图加载失败，请重新导入"));
    image.src = url;
  });

export default function SurfacePainter({
  category,
  seed,
  onPreview,
  onError,
  disabled,
}) {
  const canvas = useRef(null),
    layer = useRef(null),
    base = useRef(null),
    gesture = useRef(null),
    history = useRef({ past: [], future: [] }),
    version = useRef(0);
  const [tool, setTool] = useState("brush"),
    [color, setColor] = useState("#8a7159"),
    [width, setWidth] = useState(20),
    [opacity, setOpacity] = useState(1),
    [wrap, setWrap] = useState(true);
  const [ready, setReady] = useState(false),
    [message, setMessage] = useState(""),
    [revision, setRevision] = useState(0);
  const previewCallback = useRef(onPreview);
  previewCallback.current = onPreview;
  const render = () => {
    const ctx = canvas.current.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    if (base.current) ctx.drawImage(base.current, 0, 0, PAINT_SIZE, PAINT_SIZE);
    ctx.drawImage(layer.current, 0, 0);
  };
  const publish = () => {
    render();
    const value = canvas.current.toDataURL("image/png");
    previewCallback.current(value);
    return value;
  };
  const remember = () => {
    const stack = history.current;
    stack.past.push(
      layer.current.getContext("2d").getImageData(0, 0, PAINT_SIZE, PAINT_SIZE),
    );
    if (stack.past.length > 16) stack.past.shift();
    stack.future = [];
  };
  const persist = () => {
    render();
    const url = canvas.current.toDataURL("image/png");
    previewCallback.current(url);
    version.current++;
    setRevision(version.current);
    void writeArtwork(category, {
      image: url,
      overlay: layer.current.toDataURL("image/png"),
      base: base.current?.src || null,
    }).catch(() => setMessage("浏览器草稿保存失败，请及时保存到素材库。"));
  };
  useEffect(() => {
    let live = true;
    setReady(false);
    setMessage("");
    history.current = { past: [], future: [] };
    layer.current = document.createElement("canvas");
    layer.current.width = layer.current.height = PAINT_SIZE;
    base.current = null;
    (async () => {
      try {
        const saved = seed ? null : await readArtwork(category);
        const baseUrl = seed?.url || saved?.base;
        const loaded = baseUrl ? await loadImage(baseUrl) : null;
        if (!live) return;
        if (loaded) {
          const stable = document.createElement("canvas");
          stable.width = stable.height = PAINT_SIZE;
          stable
            .getContext("2d")
            .drawImage(loaded, 0, 0, PAINT_SIZE, PAINT_SIZE);
          const stableImage = await loadImage(stable.toDataURL("image/png"));
          if (!live) return;
          base.current = stableImage;
        }
        if (saved?.overlay) {
          const image = await loadImage(saved.overlay);
          if (!live) return;
          layer.current.getContext("2d").drawImage(image, 0, 0);
        }
        render();
        setReady(true);
        if (seed) persist();
        else publish();
      } catch (e) {
        if (live) {
          setMessage(e.message);
          onError?.(e.message);
          setReady(true);
          render();
        }
      }
    })();
    return () => {
      live = false;
      gesture.current = null;
    };
  }, [category, seed]);
  const point = (event) =>
    canvasPoint(
      canvas.current.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
  const start = (event) => {
    if (!ready || disabled || event.button !== 0) return;
    event.preventDefault();
    canvas.current.setPointerCapture(event.pointerId);
    remember();
    const p = point(event);
    gesture.current = {
      start: p,
      last: p,
      snapshot: layer.current
        .getContext("2d")
        .getImageData(0, 0, PAINT_SIZE, PAINT_SIZE),
      options: { tool, color, width, opacity, wrap },
    };
    paintMark(layer.current.getContext("2d"), p, p, gesture.current.options);
    render();
  };
  const move = (event) => {
    const g = gesture.current;
    if (!g) return;
    const p = point(event),
      ctx = layer.current.getContext("2d");
    if (["line", "rect", "ellipse"].includes(g.options.tool))
      ctx.putImageData(g.snapshot, 0, 0);
    paintMark(
      ctx,
      ["brush", "eraser"].includes(g.options.tool) ? g.last : g.start,
      p,
      g.options,
    );
    g.last = p;
    render();
  };
  const end = () => {
    if (!gesture.current) return;
    gesture.current = null;
    persist();
  };
  const undo = (redo = false) => {
    if (disabled) return;
    const stack = history.current,
      from = redo ? stack.future : stack.past,
      to = redo ? stack.past : stack.future;
    if (!from.length) return;
    to.push(
      layer.current.getContext("2d").getImageData(0, 0, PAINT_SIZE, PAINT_SIZE),
    );
    layer.current.getContext("2d").putImageData(from.pop(), 0, 0);
    persist();
  };
  return (
    <section className="surface-painter" aria-label="材质绘制画布">
      <div className="surface-paint-toolbar" aria-label="绘图工具">
        {[
          ["brush", "画笔"],
          ["eraser", "橡皮擦"],
          ["line", "直线"],
          ["rect", "矩形"],
          ["ellipse", "椭圆"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tool === id}
            onClick={() => setTool(id)}
          >
            {label}
          </button>
        ))}
        <button
          disabled={!history.current.past.length || disabled}
          onClick={() => undo()}
        >
          撤销笔画
        </button>
        <button
          disabled={!history.current.future.length || disabled}
          onClick={() => undo(true)}
        >
          重做笔画
        </button>
      </div>
      <div className="surface-paint-options">
        <label>
          画笔颜色
          <input
            aria-label="画笔颜色"
            type="color"
            value={color}
            onInput={(e) => setColor(e.target.value)}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label>
          笔宽 {width}
          <input
            aria-label="画笔宽度"
            type="range"
            min="1"
            max="100"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        <label>
          不透明度 {Math.round(opacity * 100)}%
          <input
            aria-label="画笔不透明度"
            type="range"
            min=".1"
            max="1"
            step=".05"
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={wrap}
            onChange={(e) => setWrap(e.target.checked)}
          />
          跨边续画
        </label>
      </div>
      <canvas
        ref={canvas}
        width={PAINT_SIZE}
        height={PAINT_SIZE}
        aria-label="手绘材质画布"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      />
      <div className="surface-paint-toolbar">
        <button
          disabled={!ready || disabled}
          onClick={() => {
            remember();
            const ctx = layer.current.getContext("2d");
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, PAINT_SIZE, PAINT_SIZE);
            persist();
          }}
        >
          铺满画笔颜色
        </button>
        <button
          disabled={!ready || disabled}
          onClick={() => {
            remember();
            layer.current
              .getContext("2d")
              .clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
            persist();
          }}
        >
          清空笔画
        </button>
      </div>
      <small>
        1024 × 1024 · 鼠标或触屏绘制 · 橡皮擦恢复底图 ·
        每次落笔自动同步到右侧预览 · 草稿保存在此浏览器
        {revision > 0 ? " · 已更新" : ""}
      </small>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
