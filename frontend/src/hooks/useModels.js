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
  effortLabels[value] || value || "服务默认";

export function useModels({
  initialModel,
  initialEffort,
  requiresImage = true,
} = {}) {
  const initialProvider = initialModel
    ? initialModel.startsWith("deepseek::")
      ? "deepseek"
      : "codex"
    : "";
  const [provider, setProvider] = useState(initialProvider);
  const providerRef = useRef(initialProvider);
  const manualChoice = useRef(Boolean(initialModel));
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
  const refresh = useCallback(
    async (force = false) => {
      const token = ++sequence.current;
      setLoading(true);
      setError("");
      try {
        let source = providerRef.current;
        if (!source) {
          const settings = await api("/ai/settings");
          if (token !== sequence.current) return;
          source = settings.default_provider;
          providerRef.current = source;
          setProvider(source);
        }
        const next = await api(
          `/models?provider=${source}${force ? "&refresh=true" : ""}`,
          { timeoutMs: 55000 },
        );
        if (token !== sequence.current) return;
        setCatalog(next);
        setModel((current) => {
          let saved = "";
          try {
            saved = localStorage.getItem(`habitat-model:${source}`) || "";
          } catch {}
          return chooseModel(
            next,
            !manualChoice.current && next.configured_default
              ? next.default_model
              : current || saved,
            requiresImage,
          );
        });
      } catch (e) {
        if (token !== sequence.current) return;
        setError(e.message);
        setCatalog(null);
      } finally {
        if (token === sequence.current) setLoading(false);
      }
    },
    [requiresImage],
  );
  useEffect(() => {
    refresh();
    return () => {
      sequence.current += 1;
    };
  }, [refresh]);
  const selectProvider = useCallback(
    (value) => {
      if (!["codex", "deepseek"].includes(value)) return;
      providerRef.current = value;
      manualChoice.current = false;
      setProvider(value);
      setModel("");
      setCatalog(null);
      void refresh();
    },
    [refresh],
  );
  useEffect(() => {
    const changed = (event) => selectProvider(event.detail.provider);
    window.addEventListener("habitat:ai-changed", changed);
    return () => window.removeEventListener("habitat:ai-changed", changed);
  }, [selectProvider]);
  const select = (id) => {
    manualChoice.current = true;
    setModel(id);
    try {
      localStorage.setItem("habitat-model", id);
      localStorage.setItem(`habitat-model:${providerRef.current}`, id);
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
    provider,
    selectProvider,
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
    requiresImage,
    ready: !loading && !error && selectableModel(selected, requiresImage),
  };
}
