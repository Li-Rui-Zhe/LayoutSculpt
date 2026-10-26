import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useDraftSync } from "./useDraftSync.js";
import { showcase } from "../catalog.js";

export const initialStudio = {
  category: "walls",
  selected: { walls: null, floor: null, fabric: null },
  floorTarget: "all",
  roomFloors: {},
  preset: "midday",
  mood: "cozy",
  daylight: 74,
};
function load(storageKey) {
  try {
    const s = JSON.parse(localStorage.getItem(storageKey));
    if (
      s?.selected &&
      ["morning", "midday", "evening", "night"].includes(s.preset)
    )
      return {
        ...initialStudio,
        ...Object.fromEntries(
          Object.entries(s).filter(([k]) => k !== "_savedAt"),
        ),
        category: s.category === "fabric" ? "walls" : s.category,
        selected: { ...s.selected, fabric: null },
        preset: s.preset === "night" ? "night" : "midday",
      };
  } catch {}
  return structuredClone(initialStudio);
}
export function useStudio(taskId = "sample") {
  const storageKey = `habitat-studio:${taskId === "sample" ? `sample:${showcase.id}` : taskId}`;
  const [history, setHistory] = useState(() => ({
    past: [],
    present: load(storageKey),
    future: [],
  }));
  const modified = useRef(false);
  const [storageError, setStorageError] = useState("");
  const [serverRevision, setServerRevision] = useState(null);
  const sync = useDraftSync(
    `studio:${taskId}`,
    history.present,
    serverRevision,
    (merged) => setHistory({ past: [], present: merged, future: [] }),
  );
  useEffect(() => {
    let alive = true;
    let retryTimer;
    let controller;
    const read = () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      api(`/drafts/studio:${taskId}`, { signal: controller.signal })
        .then((value) => {
          if (!alive) return;
          let local = null;
          try {
            local = JSON.parse(localStorage.getItem(storageKey));
          } catch {}
          if (
            !modified.current &&
            value.document &&
            (!local?._savedAt || local._savedAt <= value.updated_at)
          )
            setHistory({ past: [], present: value.document, future: [] });
          setServerRevision(value.revision);
        })
        .catch(() => {
          if (alive) {
            setStorageError("外观设置尚未同步，正在重试…");
            retryTimer = setTimeout(read, 5000);
          }
        })
        .finally(() => clearTimeout(timeout));
    };
    read();
    return () => {
      alive = false;
      clearTimeout(retryTimer);
      controller?.abort();
    };
  }, [taskId, storageKey]);
  useEffect(() => {
    try {
      if (serverRevision !== null || modified.current)
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            ...history.present,
            _savedAt: new Date().toISOString(),
          }),
        );
      setStorageError("");
    } catch {
      setStorageError(
        "浏览器存储不可用，外观调整仅在本次打开时保留；已生成模型不受影响。",
      );
    }
  }, [storageKey, history.present, serverRevision]);
  const update = useCallback(
    (change) =>
      setHistory((h) => {
        modified.current = true;
        const value =
          typeof change === "function"
            ? change(h.present)
            : { ...h.present, ...change };
        return {
          past: [...h.past, h.present].slice(-40),
          present: value,
          future: [],
        };
      }),
    [storageKey],
  );
  const step = useCallback(
    (direction) =>
      setHistory((h) => {
        const source = direction === "undo" ? h.past : h.future;
        if (!source.length) return h;
        const value = source[source.length - 1];
        return direction === "undo"
          ? {
              past: h.past.slice(0, -1),
              present: value,
              future: [...h.future, h.present],
            }
          : {
              past: [...h.past, h.present],
              present: value,
              future: h.future.slice(0, -1),
            };
      }),
    [storageKey],
  );
  return {
    state: history.present,
    storageError: sync.error || storageError,
    update,
    undo: () => step("undo"),
    redo: () => step("redo"),
    canUndo: !!history.past.length,
    canRedo: !!history.future.length,
  };
}
