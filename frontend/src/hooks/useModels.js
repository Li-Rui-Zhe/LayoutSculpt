import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { chooseModel, selectableModel } from "./modelSelection.js";

const effortLabels = {
  none: "关闭",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "极高",
  ultra: "最高",
};
export const effortLabel = (value) =>
  effortLabels[value] || value || "本地默认";

export function useModels({ initialModel, initialEffort } = {}) {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [model, setModel] = useState(() => {
    try {
      return initialModel || localStorage.getItem("habitat-model") || "";
    } catch {
      return initialModel || "";
    }
  });
  const [savedEfforts, setSavedEfforts] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem("habitat-model-efforts"));
      const saved =
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {};
      return initialModel && initialEffort
        ? { ...saved, [initialModel]: initialEffort }
        : saved;
    } catch {
      return initialModel && initialEffort
        ? { [initialModel]: initialEffort }
        : {};
    }
  });
  const sequence = useRef(0);
  const refresh = useCallback(async (force = false) => {
    const token = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const next = await api(`/models${force ? "?refresh=true" : ""}`);
      if (token !== sequence.current) return;
      setCatalog(next);
      setModel((current) => chooseModel(next, current));
    } catch (e) {
      if (token !== sequence.current) return;
      setError(e.message);
      setCatalog(null);
    } finally {
      if (token === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    return () => {
      sequence.current += 1;
    };
  }, [refresh]);
  const select = (id) => {
    setModel(id);
    try {
      localStorage.setItem("habitat-model", id);
    } catch {
      /* Model selection still works for this session. */
    }
  };
  const selected = catalog?.items.find((item) => item.id === model);
  const efforts = selected?.efforts || [];
  const effort = efforts.includes(savedEfforts[model])
    ? savedEfforts[model]
    : efforts.includes(selected?.default_effort)
      ? selected.default_effort
      : "";
  const selectEffort = (value) => {
    if (!efforts.includes(value)) return;
    const next = { ...savedEfforts, [model]: value };
    setSavedEfforts(next);
    try {
      localStorage.setItem("habitat-model-efforts", JSON.stringify(next));
    } catch {
      /* Effort remains in React state. */
    }
  };
  return {
    catalog,
    loading,
    error,
    model,
    select,
    refresh,
    selected,
    efforts,
    effort,
    selectEffort,
    ready: !loading && !error && selectableModel(selected),
  };
}
