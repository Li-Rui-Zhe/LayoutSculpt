import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { createDraftSession } from "./draftSession.js";

export function useDraftSync(key, document, initialRevision, onMerge) {
  const mergeCallback = useRef(onMerge);
  mergeCallback.current = onMerge;
  const session = useRef(null);
  const [status, setStatus] = useState({ message: "正在读取草稿", error: "" });
  useEffect(() => {
    if (initialRevision == null) return;
    const current = createDraftSession(
      key,
      initialRevision,
      async (key, body) =>
        api(`/drafts/${key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      (value) => {
        if (session.current === current) {
          if (value.document) mergeCallback.current?.(value.document);
          setStatus(value);
        }
      },
      650,
      onMerge ? { read: (key) => api(`/drafts/${key}`) } : {},
    );
    session.current = current;
    return () => {
      session.current = null;
      void current.flush();
    };
  }, [key, initialRevision]);
  useEffect(() => {
    if (!document || initialRevision == null) return;
    session.current?.schedule(document);
  }, [key, document, initialRevision]);
  useEffect(() => {
    const flush = () => {
      if (globalThis.document.visibilityState === "hidden")
        void session.current?.flush();
    };
    globalThis.document.addEventListener("visibilitychange", flush);
    return () =>
      globalThis.document.removeEventListener("visibilitychange", flush);
  }, []);
  return status;
}
