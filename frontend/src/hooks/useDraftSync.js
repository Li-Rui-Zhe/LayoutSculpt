import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { createDraftSession } from "./draftSession.js";

export function useDraftSync(
  key,
  document,
  initialRevision,
  onMerge,
  options = {},
) {
  const mergeCallback = useRef(onMerge);
  mergeCallback.current = onMerge;
  const optionsRef = useRef(options);
  optionsRef.current = options;
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
          if (value.syncedDocument)
            optionsRef.current.onSaved?.(
              value.syncedDocument,
              value.syncedRevision,
            );
          if (value.document) mergeCallback.current?.(value.document);
          setStatus(value);
        }
      },
      650,
      {
        ...(onMerge ? { read: (key) => api(`/drafts/${key}`) } : {}),
        baseDocument: optionsRef.current.baseDocument,
      },
    );
    session.current = current;
    return () => {
      session.current = null;
      void current.close();
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
    const online = () => {
      void session.current?.flush();
    };
    globalThis.addEventListener?.("online", online);
    return () => {
      globalThis.document.removeEventListener("visibilitychange", flush);
      globalThis.removeEventListener?.("online", online);
    };
  }, []);
  return status;
}
