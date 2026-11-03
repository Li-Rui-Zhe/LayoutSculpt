import { useState, useRef, useEffect } from "react";
import { api } from "../api.js";

export default function FurnitureSizing({ item, onApply }) {
  const [name, setName] = useState(item.name || "我的家具");
  const [size, setSize] = useState(
    [item.width, item.depth, item.height].map((n) =>
      String(Math.round(n * 1000) / 10),
    ),
  );
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    setName(item.name || "我的家具");
    setSize(
      [item.width, item.depth, item.height].map((n) =>
        String(Math.round(n * 1000) / 10),
      ),
    );
  }, [item.name, item.width, item.depth, item.height]);
  const value = () => {
    const [width, depth, height] = size.map((n) =>
      n.trim() ? Number(n) / 100 : NaN,
    );
    if (
      ![width, depth, height].every(Number.isFinite) ||
      width < 0.1 ||
      width > 6 ||
      depth < 0.1 ||
      depth > 6 ||
      height < 0.02 ||
      height > 3
    )
      throw Error("请输入有效尺寸：宽、深 10～600 cm，高 2～300 cm。");
    if (!name.trim()) throw Error("请填写家具名称。");
    return { ...item, name: name.trim(), width, depth, height };
  };
  return (
    <details className="property-disclosure furniture-sizing">
      <summary>按商品尺寸试摆</summary>
      <p>用相近模型试尺寸，不代表商品外形完全一致。按宽 × 深 × 高填写。</p>
      <label className="edit-label">
        家具名称
        <input
          aria-label="试摆家具名称"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="edit-number-grid">
        {["商品宽度", "商品进深", "商品高度"].map((label, i) => (
          <label className="edit-label" key={label}>
            {label}（cm）
            <input
              type="number"
              step="0.1"
              aria-label={label}
              value={size[i]}
              onChange={(e) =>
                setSize((v) => v.map((n, j) => (j === i ? e.target.value : n)))
              }
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          try {
            const result = onApply(value());
            if (result !== true)
              throw Error(
                typeof result === "string" ? result : "当前无法应用尺寸",
              );
            setMessage("尺寸已应用，可以拖动试摆或撤销。");
          } catch (e) {
            setMessage(e.message);
          }
        }}
      >
        应用尺寸试摆
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setMessage("");
          try {
            await api("/furniture-presets", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(value()),
            });
            setMessage("已存到“我的家具”，可在其他户型中重复使用。");
          } catch (e) {
            setMessage(e.message);
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? "正在保存…" : "存到我的家具"}
      </button>
      {message && <p role="status">{message}</p>}
    </details>
  );
}

export function MyFurniture({ onPlace }) {
  const [items, setItems] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  const read = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const result = await api("/furniture-presets", {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setItems(result.items);
        setError("");
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <details
      className="my-furniture"
      onToggle={(e) => {
        if (e.currentTarget.open) void read();
      }}
    >
      <summary>我的家具 · 真实尺寸试摆</summary>
      <p>选中家具，在右侧“按商品尺寸试摆”中保存。记录仅保存在本机。</p>
      <button type="button" disabled={busy} onClick={read}>
        {busy ? "正在读取…" : "刷新列表"}
      </button>
      {!busy && !items.length && <p>还没有保存家具。</p>}
      {items.map(({ id, item }) => (
        <div className="personal-furniture-item" key={id}>
          <strong>{item.name}</strong>
          <small>
            {[item.width, item.depth, item.height]
              .map((n) => Math.round(n * 1000) / 10)
              .join(" × ")}{" "}
            cm
          </small>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              try {
                onPlace(item);
                setError("");
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            选择位置
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/furniture-presets/${id}`, { method: "DELETE" });
                setItems((list) => list.filter((v) => v.id !== id));
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            移除记录
          </button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
