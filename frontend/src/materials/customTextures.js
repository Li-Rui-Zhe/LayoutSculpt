import { useEffect, useSyncExternalStore } from "react";
import { materials, materialCategories, compatibleMaterialCategories } from "../catalog.js";
import { api } from "../api.js";
let version = 0, pending, loadedAt = 0;
let status = { error: "", unavailable: [] };
const listeners = new Set();
const notify = () => { version++; listeners.forEach(fn => fn()); };
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export async function loadCustomTextures(refresh = false, announce = true) {
  if (pending) return pending;
  if (!refresh && Date.now() - loadedAt < 15000) return;
  pending = api("/materials/custom").then(v => {
    for (const collection of [materialCategories, compatibleMaterialCategories]) {
      for (const category of ["walls", "floor"]) collection[category] = collection[category].filter(id => !id.startsWith("texture:"));
    }
    for (const item of v.items) {
      if (!/^texture:[a-f0-9]{64}$/.test(item.id)) continue;
      const index = materials.findIndex(m => m.id === item.id);
      if (index < 0) materials.push(item); else materials[index] = item;
      for (const category of item.categories || ["walls", "floor"]) {
        if (!materialCategories[category]) continue;
        for (const collection of [materialCategories, compatibleMaterialCategories]) {
          if (!collection[category].includes(item.id)) collection[category].push(item.id);
        }
      }
    }
    status = { error: "", unavailable: v.unavailable || [] };
    loadedAt = Date.now();
    if (refresh && announce) {
      try { localStorage.setItem("materials:updated", String(Date.now())); } catch {}
    }
    notify();
  }).catch(error => { status = { ...status, error: error.message }; notify(); })
    .finally(() => { pending = null; });
  return pending;
}
export function useCustomTextures() {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    void loadCustomTextures();
    const refresh = () => { if (!document.hidden) void loadCustomTextures(); };
    const storage = event => { if (event.key === "materials:updated") void loadCustomTextures(true, false); };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storage);
    const timer = setInterval(refresh, 30000);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("storage", storage); };
  }, []);
  return status;
}
