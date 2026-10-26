import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api.js";
import { createDraftSession } from "./draftSession.js";
import {
  emptyPreferences,
  applyPreference,
  rebasePreferences,
} from "./libraryPreferencesState.js";

let local = {};
try {
  local = JSON.parse(localStorage.getItem("library-preferences")) || {};
} catch {}
let state = {
  value: { ...emptyPreferences(), ...local },
  ready: true,
  error: "",
};
let session,
  loading,
  retryTimer,
  started = false;
let operations = [];
try {
  const saved = JSON.parse(
    localStorage.getItem("library-preference-operations"),
  );
  if (Array.isArray(saved))
    operations = saved.filter(
      (op) =>
        op &&
        ["favorites", "archived", "recent", "aiEnabled"].includes(op.key) &&
        typeof op.id === "string" &&
        typeof op.enabled === "boolean",
    );
} catch {}
const listeners = new Set();
const publish = (next) => {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
};
const persist = () => {
  try {
    localStorage.setItem("library-preferences", JSON.stringify(state.value));
    localStorage.setItem(
      "library-preference-operations",
      JSON.stringify(operations),
    );
  } catch {}
};
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
function load() {
  if (loading) return loading;
  clearTimeout(retryTimer);
  loading = (async () => {
    try {
      const previous = session;
      session = null;
      if (previous) await previous.close();
      const remote = await api("/drafts/library:new");
      const value = rebasePreferences(
        remote.document || state.value,
        operations,
      );
      publish({ value, error: "" });
      persist();
      session = createDraftSession(
        "library:new",
        remote.revision,
        (key, body) =>
          api(`/drafts/${key}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        (status) => {
          if (status.syncedDocument) {
            operations = operations.filter((op) =>
              op.key === "recent"
                ? status.syncedDocument.recent?.[0] !== op.id
                : status.syncedDocument[op.key]?.includes(op.id) !== op.enabled,
            );
            persist();
          }
          publish({ error: status.error || "" });
        },
        650,
      );
      if (operations.length || !remote.document) session.schedule(value);
    } catch (e) {
      publish({ error: e.message });
      retryTimer = setTimeout(() => {
        if (listeners.size) void load();
      }, 5000);
    } finally {
      loading = null;
    }
  })();
  return loading;
}
const change = (key, id) => {
  if (!["favorites", "archived", "recent", "aiEnabled"].includes(key)) return;
  const op = { key, id, enabled: !(state.value[key] || []).includes(id) };
  operations = operations.filter((old) => old.key !== key || old.id !== id);
  operations.push(op);
  publish({ value: applyPreference(state.value, op) });
  persist();
  if (session) session.schedule(state.value);
  else void load();
};
export function useLibraryPreferences() {
  const current = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    const recover = () => {
      if (!session || state.error) void load();
    };
    if (!started) {
      started = true;
      void load();
    } else recover();
    window.addEventListener("online", recover);
    window.addEventListener("focus", recover);
    return () => {
      window.removeEventListener("online", recover);
      window.removeEventListener("focus", recover);
    };
  }, []);
  return { ...current, change, reload: load };
}
