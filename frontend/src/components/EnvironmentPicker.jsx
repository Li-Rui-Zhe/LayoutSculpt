import { useEffect, useRef, useState, useId } from "react";
import { Sun, Sunset, Moon, ChevronDown, Check } from "lucide-react";
import { presets } from "../catalog.js";
import { normalizeEnvironment } from "../viewer/environment.js";
import "./environmentPicker.css";

const icons = { midday: Sun, sunset: Sunset, night: Moon };

export default function EnvironmentPicker({
  value,
  onChange,
  inline = false,
  thumbnails = {},
}) {
  const [open, setOpen] = useState(false);
  const host = useRef(null),
    trigger = useRef(null),
    panelId = useId();
  const selected = presets.find((p) => p.id === normalizeEnvironment(value));
  const Icon = icons[selected.id];
  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (!host.current?.contains(e.target)) setOpen(false);
    };
    const escape = (e) => {
      if (e.key === "Escape") {
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
  return (
    <div
      ref={host}
      className={`environment-picker ${inline ? "is-inline" : ""}`}
    >
      {!inline && (
        <button
          ref={trigger}
          type="button"
          className="environment-trigger"
          aria-label={`环境：${selected.name}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          <Icon size={15} />
          <span>环境 · {selected.name}</span>
          <ChevronDown size={12} />
        </button>
      )}
      {(inline || open) && (
        <div
          id={panelId}
          className="environment-panel"
          aria-label="环境氛围"
          role="group"
        >
          {!inline && (
            <header>
              <strong>此刻的光</strong>
              <span>给空间换一种心情</span>
            </header>
          )}
          <div className="environment-options">
            {presets.map((p) => {
              const OptionIcon = icons[p.id];
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`environment-option environment-${p.id}`}
                  aria-pressed={p.id === selected.id}
                  aria-label={`切换到${p.name}`}
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                    if (!inline) trigger.current?.focus();
                  }}
                >
                  <span className="environment-art" aria-hidden="true">
                    {inline && thumbnails[p.id] ? (
                      <img src={thumbnails[p.id]} alt="" />
                    ) : (
                      <>
                        <i className="environment-orb" />
                        <i className="environment-horizon" />
                        <i className="environment-house" />
                      </>
                    )}
                    {p.id === selected.id && (
                      <span className="environment-check">
                        <Check size={11} />
                      </span>
                    )}
                  </span>
                  <span className="environment-name">
                    <OptionIcon size={13} />
                    {p.name}
                  </span>
                  <small>{p.description}</small>
                </button>
              );
            })}
          </div>
          <p className="environment-caption">
            氛围预览 · 不改变设计，不代表真实采光分析
          </p>
        </div>
      )}
    </div>
  );
}
