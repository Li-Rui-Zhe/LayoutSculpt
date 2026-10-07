import { useCallback, useEffect, useState } from "react";
import { showcase } from "../catalog.js";

export const initialStudio = {
  category: "walls",
  selected: { walls: null, floor: null, fabric: null },
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
        ...s,
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
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(history.present));
      setStorageError("");
    } catch {
      setStorageError(
        "浏览器存储不可用，外观调整仅在本次打开时保留；已生成模型不受影响。",
      );
    }
  }, [storageKey, history.present]);
  const update = useCallback(
    (change) =>
      setHistory((h) => {
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
    storageError,
    update,
    undo: () => step("undo"),
    redo: () => step("redo"),
    canUndo: !!history.past.length,
    canRedo: !!history.future.length,
  };
}
