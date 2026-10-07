import { useEffect, useState } from "react";
import { api } from "../api.js";
import { toDraft, clone, restorableDraft } from "./geometry.js";
import { fitOutline } from "./autoOutline.js";

export function useEditDraft(jobId, reviewing = false) {
  const key = `habitat-edit:${jobId}${reviewing ? ":structure" : ""}`;
  const [base, setBase] = useState(null),
    [history, setHistory] = useState(null);
  const [error, setError] = useState(""),
    [storageError, setStorageError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setError("");
    api(`/jobs/${jobId}/artifacts/${reviewing ? "structure" : "layout"}.json`)
      .then((data) => {
        if (!alive) return;
        const original = toDraft(data);
        let restored = original;
        try {
          const saved = JSON.parse(localStorage.getItem(key));
          if (saved?.version === 1 && restorableDraft(saved.document))
            restored = saved.document;
          restored.layout.lights ||= [];
        } catch {
          /* 损坏的本地草稿回退至原始数据。 */
        }
        setBase(original);
        setHistory({ past: [], present: restored, future: [] });
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [jobId, key, revision, reviewing]);
  useEffect(() => {
    if (!history) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, document: history.present }),
      );
      setStorageError("");
    } catch {
      setStorageError(
        "浏览器存储空间不足，当前草稿暂未自动保存，请保存为三维版本。",
      );
    }
  }, [history?.present, key]);
  const commit = (next, autoFit = true) =>
    setHistory((current) => {
      const changed =
        typeof next === "function" ? next(clone(current.present)) : next;
      const value = autoFit ? fitOutline(current.present, changed) : changed;
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
    document: history?.present,
    error,
    storageError,
    commit,
    undo,
    redo,
    canUndo: !!history?.past.length,
    canRedo: !!history?.future.length,
    reset: () => commit(clone(base), false),
    reload: () => setRevision((value) => value + 1),
  };
}
