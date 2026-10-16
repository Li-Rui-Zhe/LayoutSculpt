import { useEffect, useState } from "react";

export function readContext(key, fallback = "") {
  if (typeof location === "undefined") return fallback;
  const value = new URL(location.href).searchParams.get(key);
  const allowed = {
    tab: ["design", "source", "activity", "assets", "edit", "review"],
    editorView: ["plan", "scene"],
    diyMode: ["furniture", "walls", "floor"],
    assetType: ["models", "materials"],
    materialCategory: ["walls", "floor"],
    librarySource: ["all", "builtin", "imported", "diy", "generated", "sample"],
    librarySort: ["source", "name", "size"],
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
  useEffect(() => {
    const restore = () =>
      setValue(
        readContext(
          key,
          typeof fallback === "function" ? fallback() : fallback,
        ),
      );
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [key]);
  useEffect(() => {
    if (active) writeContext({ [key]: value });
  }, [key, value, active]);
  return [value, setValue];
}
