import { useEffect, useId, useRef, useState } from "react";
import { Settings2, X } from "lucide-react";
import { api } from "../api.js";
import { loadCustomTextures } from "../materials/customTextures.js";

const size = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
export default function AssetManager({ onChange }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null),
    trigger = useRef(null),
    panelId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const run = async (action) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (action) {
        await action();
        await loadCustomTextures(true);
        onChange();
      }
      setData(await api("/library/manage"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const change = (id, fields) =>
    run(async () => {
      await api("/library/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...fields }),
      });
      setEditing(null);
    });
  return (
    <section className="asset-manager" ref={root}>
      <button
        ref={trigger}
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) void run();
        }}
      >
        <Settings2 size={14} />
        素材管理
      </button>
      {open && (
        <div id={panelId} role="region" aria-label="本机素材与空间">
          <header className="asset-manager-heading">
            <h2>本机素材与空间</h2>
            <button aria-label="关闭素材管理" onClick={() => setOpen(false)}>
              <X size={17} />
            </button>
          </header>
          <p>
            归档会从选材目录中隐藏素材，已有方案仍可正常显示；可随时恢复。DIY
            家具请在创作页管理。
          </p>
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">正在处理…</p>}
          {data && (
            <>
              <div className="storage-usage">
                {data.usage.map((g) => (
                  <span key={g.name}>
                    {g.name}：{size(g.bytes)} · {g.files} 个文件
                  </span>
                ))}
              </div>
              <button
                disabled={
                  busy ||
                  !data.usage.some(
                    (g) => g.name === "AI 结果缓存" && g.bytes > 0,
                  )
                }
                onClick={() =>
                  run(() => api("/maintenance/cache", { method: "POST" }))
                }
              >
                清理可重建的 AI 缓存（
                {size(
                  data.usage.find((g) => g.name === "AI 结果缓存")?.bytes || 0,
                )}
                ）
              </button>
              <p>
                清理范围仅限可重新生成的 AI 结果缓存。方案、素材和草稿会保留。
              </p>
              <input
                aria-label="搜索可管理素材"
                placeholder="搜索导入家具或墙地面材质"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="managed-assets">
                {data.items
                  .filter((i) => `${i.name} ${i.kind}`.includes(query))
                  .map((i) => (
                    <div key={i.id}>
                      <span>
                        {i.kind} · {i.name} {i.archived ? "（已归档）" : ""}
                      </span>
                      {editing === i.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            change(i.id, { name });
                          }}
                        >
                          <input
                            aria-label="素材新名称"
                            value={name}
                            maxLength={60}
                            onChange={(e) => setName(e.target.value)}
                          />
                          <button type="submit" disabled={busy || !name.trim()}>
                            保存名称
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                          >
                            取消
                          </button>
                        </form>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => {
                            setEditing(i.id);
                            setName(i.name);
                          }}
                        >
                          重命名
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => change(i.id, { archived: !i.archived })}
                      >
                        {i.archived ? "恢复" : "归档"}
                      </button>
                    </div>
                  ))}
              </div>
              {!data.items.length && <p>尚无导入家具或自定义墙地面素材。</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
