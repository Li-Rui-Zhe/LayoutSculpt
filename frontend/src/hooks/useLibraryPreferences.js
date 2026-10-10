import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api.js";
import { createDraftSession } from "./draftSession.js";
let state = {
    value: { favorites: [], archived: [], recent: [] },
    ready: false,
    error: "",
  },
  started = false,
  session;
const listeners = new Set();
const publish = (next) => {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
};
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
async function load() {
  try {
    const v = await api("/drafts/library:new");
    let local = null;
    try {
      local = JSON.parse(localStorage.getItem("library-preferences"));
    } catch {}
    publish({
      value: v.document || local || state.value,
      ready: true,
      error: "",
    });
    session = createDraftSession(
      "library:new",
      v.revision,
      (key, body) =>
        api(`/drafts/${key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      (status) => publish({ error: status.error }),
    );
  } catch (e) {
    publish({ error: e.message });
  }
}
const change = (key, id) => {
  if (!state.ready) return;
  const list = state.value[key] || [];
  const value = {
    ...state.value,
    [key]:
      key === "recent"
        ? [id, ...list.filter((x) => x !== id)].slice(0, 50)
        : list.includes(id)
          ? list.filter((x) => x !== id)
          : [...list, id],
  };
  publish({ value });
  try {
    localStorage.setItem("library-preferences", JSON.stringify(value));
  } catch {}
  session.schedule(value);
};
export function useLibraryPreferences() {
  const current = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!started) {
      started = true;
      void load();
    }
  }, []);
  return { ...current, change, reload: load };
}
