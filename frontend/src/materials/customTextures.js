import { useEffect, useSyncExternalStore } from "react";
import {
  materials,
  materialCategories,
  compatibleMaterialCategories,
} from "../catalog.js";
import { api } from "../api.js";
let version = 0,
  pending;
const listeners = new Set();
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export async function loadCustomTextures(refresh = false) {
  if (!pending || refresh)
    pending = api("/materials/custom")
      .then((v) => {
        for (const item of v.items) {
          if (!/^texture:[a-f0-9]{64}$/.test(item.id)) continue;
          const index = materials.findIndex((m) => m.id === item.id);
          if (index < 0) materials.push(item);
          else materials[index] = item;
          for (const category of ["walls", "floor"]) {
            if (!materialCategories[category].includes(item.id))
              materialCategories[category].push(item.id);
            if (!compatibleMaterialCategories[category].includes(item.id))
              compatibleMaterialCategories[category].push(item.id);
          }
        }
        version++;
        listeners.forEach((fn) => fn());
      })
      .catch(() => {
        pending = null;
      });
  return pending;
}
export function useCustomTextures() {
  const value = useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    void loadCustomTextures();
  }, []);
  return value;
}
