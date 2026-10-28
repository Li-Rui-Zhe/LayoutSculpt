import { useCallback, useEffect, useRef, useState } from "react";

export function readContext(key, fallback = "") {
  if (typeof location === "undefined") return fallback;
  const value = new URL(location.href).searchParams.get(key);
  const allowed = {
    tab: ["design", "source", "activity", "assets", "edit", "review"],
    editorView: ["plan", "scene"],
    diyMode: ["furniture", "walls", "floor"],
    assetType: ["models", "materials", "architecture"],
    materialCategory: ["walls", "floor"],
    librarySource: ["all", "builtin", "imported", "diy", "generated", "sample"],
    librarySort: ["source", "name", "recent"],
  };
  if (
    value == null ||
    value.length > 200 ||
    (allowed[key] && !allowed[key].includes(value))
  )
    return fallback;
  if (
    ["project", "diyAsset"].includes(key) &&
    !/^(sample|[a-f0-9]{32})$/.test(value)
  )
    return fallback;
  return value;
}

export function writeContext(values) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value == null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  if (url.href !== location.href) history.replaceState(null, "", url);
}

// URL stores object references and view choices only; drafts remain in SQLite.
export function useUrlContext(key, fallback, active = true) {
  const [value, setValue] = useState(() =>
    readContext(key, typeof fallback === "function" ? fallback() : fallback),
  );
  const current = useRef(value);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  useEffect(() => {
    const restore = () => {
      const fallbackValue = fallbackRef.current;
      const restored = readContext(
        key,
        typeof fallbackValue === "function" ? fallbackValue() : fallbackValue,
      );
      current.current = restored;
      setValue(restored);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [key]);
  useEffect(() => {
    if (active && Object.is(current.current, value))
      writeContext({ [key]: value });
  }, [key, value, active]);
  // Store an explicit UI choice before a hash navigation can restore older URL state.
  const change = useCallback(
    (next) => {
      const resolved =
        typeof next === "function" ? next(current.current) : next;
      current.current = resolved;
      writeContext({ [key]: resolved });
      setValue(resolved);
    },
    [key],
  );
  return [value, change];
}
