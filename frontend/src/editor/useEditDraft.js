import { useEffect, useState } from "react";
import { api } from "../api.js";
import { toDraft, clone, restorableDraft } from "./geometry.js";
import {
  identifyObjects,
  lockedChange,
  designFingerprint,
} from "./objectIdentity.js";
import { fitOutline } from "./autoOutline.js";
import { useDraftSync } from "../hooks/useDraftSync.js";

export function useEditDraft(jobId, reviewing = false) {
  const key = `habitat-edit:${jobId}${reviewing ? ":structure" : ""}`;
  const [constraintError, setConstraintError] = useState("");
  const [base, setBase] = useState(null),
    [history, setHistory] = useState(null);
  const [error, setError] = useState(""),
    [storageError, setStorageError] = useState("");
  const [revision, setRevision] = useState(0);
  const [serverRevision, setServerRevision] = useState(null);
  const [loadedKey, setLoadedKey] = useState(null);
  const serverKey = `${reviewing ? "structure" : "edit"}:${jobId}`;
  const sync = useDraftSync(
    serverKey,
    history?.present,
    loadedKey === serverKey ? serverRevision : null,
    (merged) => setHistory({ past: [], present: merged, future: [] }),
  );
  useEffect(() => {
    let alive = true;
    setError("");
    setLoadedKey(null);
    setServerRevision(null);
    Promise.all([
      api(
        `/jobs/${jobId}/artifacts/${reviewing ? "structure" : "layout"}.json`,
      ),
      api(`/drafts/${serverKey}`).catch(() => null),
    ])
      .then(([data, server]) => {
        if (!alive) return;
        const original = identifyObjects(toDraft(data), true);
        let restored = original;
        try {
          const saved = JSON.parse(localStorage.getItem(key));
          if (
            !server?.document &&
            saved?.version === 1 &&
            restorableDraft(saved.document)
          )
            restored = saved.document;
          restored.layout.lights ||= [];
        } catch {
          /* 损坏的本地草稿回退至原始数据。 */
        }
        if (server?.document && restorableDraft(server.document))
          restored = server.document;
        setLoadedKey(serverKey);
        restored = identifyObjects(restored, true);
        setBase(original);
        setHistory({ past: [], present: restored, future: [] });
        setServerRevision(server?.revision ?? null);
        if (!server)
          setStorageError(
            "后端草稿未连接，修改仅保存在当前浏览器；请重新读取以恢复同步。",
          );
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [jobId, key, revision, reviewing]);
  useEffect(() => {
    if (!history || loadedKey !== serverKey) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, document: history.present }),
      );
      if (serverRevision !== null) setStorageError("");
    } catch {
      setStorageError(
        "浏览器存储空间不足，当前草稿暂未自动保存，请保存为三维版本。",
      );
    }
  }, [history?.present, key, loadedKey, serverKey, serverRevision]);
  const commit = (next, autoFit = true) =>
    setHistory((current) => {
      const changed =
        typeof next === "function" ? next(clone(current.present)) : next;
      const value = identifyObjects(
        autoFit ? fitOutline(current.present, changed) : changed,
      );
      const violation = lockedChange(current.present, value);
      if (violation) {
        setConstraintError(violation);
        return current;
      }
      setConstraintError("");
      if (JSON.stringify(value) === JSON.stringify(current.present))
        return current;
      return {
        past: [...current.past, current.present].slice(-60),
        present: value,
        future: [],
      };
    });
  const undo = () =>
    setHistory((h) =>
      !h?.past.length
        ? h
        : {
            past: h.past.slice(0, -1),
            present: h.past.at(-1),
            future: [...h.future, h.present],
          },
    );
  const redo = () =>
    setHistory((h) =>
      !h?.future.length
        ? h
        : {
            past: [...h.past, h.present],
            present: h.future.at(-1),
            future: h.future.slice(0, -1),
          },
    );
  return {
    base,
    constraintError,
    document: history?.present,
    error,
    storageError: sync.error || storageError,
    syncStatus: sync.message,
    dirty:
      !!base &&
      !!history &&
      JSON.stringify(designFingerprint(base)) !==
        JSON.stringify(designFingerprint(history.present)),
    commit,
    undo,
    redo,
    canUndo: !!history?.past.length,
    canRedo: !!history?.future.length,
    reset: () => commit(clone(base), false),
    reload: () => setRevision((value) => value + 1),
  };
}
