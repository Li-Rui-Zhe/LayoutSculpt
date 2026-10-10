import { useEffect, useState } from "react";
import { api } from "../api.js";

export function useDesignCheck(document, enabled) {
  const [result, setResult] = useState({ status: "idle", issues: [] });
  useEffect(() => {
    if (!enabled || !document) {
      setResult({ status: "idle", issues: [] });
      return;
    }
    let live = true;
    const controller = new AbortController();
    setResult({ status: "checking", issues: [] });
    const timer = setTimeout(async () => {
      try {
        const data = await api("/design/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...document, name: "设计检查" }),
          signal: controller.signal,
        });
        if (live) setResult({ status: "done", issues: data.issues });
      } catch (e) {
        if (live)
          setResult({
            status: "error",
            issues: [{ severity: "warning", text: e.message }],
          });
      }
    }, 700);
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [document, enabled]);
  return result;
}
