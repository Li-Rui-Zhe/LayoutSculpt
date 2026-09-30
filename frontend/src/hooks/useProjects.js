import { useCallback, useEffect, useRef, useState } from "react";
import { api, terminal } from "../api.js";

// 列表是任务状态的唯一来源；异步响应只更新自己的任务，不能改变当前选择。
export function useProjects() {
  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState(
    () => localStorage.getItem("habitat-job") || "sample",
  );
  const [timeline, setTimeline] = useState({ id: null, items: [] });
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const selection = useRef(selectedId);
  const listRequest = useRef(0);
  const merge = useCallback((items) => {
    setJobs((previous) => {
      const map = new Map(previous.map((item) => [item.id, item]));
      for (const item of items) {
        const old = map.get(item.id);
        if (!old || Date.parse(item.updated_at) >= Date.parse(old.updated_at))
          map.set(item.id, item);
      }
      return [...map.values()].sort(
        (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
      );
    });
  }, []);
  const refresh = useCallback(async () => {
    const token = ++listRequest.current;
    try {
      const [h, j] = await Promise.all([api("/health"), api("/jobs")]);
      if (token !== listRequest.current) return;
      setHealth(h);
      merge(j.items);
      setError("");
    } catch {
      if (token !== listRequest.current) return;
      setHealth(null);
      setError("本地服务未连接，任务记录将在连接恢复后同步。");
    } finally {
      if (token === listRequest.current) setLoading(false);
    }
  }, [merge]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      clearInterval(timer);
      listRequest.current += 1;
    };
  }, [refresh]);
  const select = useCallback((item) => {
    const id = item?.id || "sample";
    selection.current = id;
    setSelectedId(id);
    localStorage.setItem("habitat-job", id);
  }, []);
  useEffect(() => {
    if (selectedId === "sample") return;
    let alive = true;
    api(`/jobs/${selectedId}`)
      .then((item) => {
        if (alive) merge([item]);
      })
      .catch(() => {});
    setTimeline({ id: selectedId, items: [] });
    const stream = new EventSource(`/api/jobs/${selectedId}/events`);
    const addEvents = (items) => {
      if (!alive) return;
      setTimeline((current) => ({
        id: selectedId,
        items: [
          ...new Map(
            [...(current.id === selectedId ? current.items : []), ...items].map(
              (e) => [e.id, e],
            ),
          ).values(),
        ]
          .sort((a, b) => a.id - b.id)
          .slice(-100),
      }));
    };
    const loadTimeline = async () => {
      let after = 0;
      while (alive) {
        const data = await api(`/jobs/${selectedId}/timeline?after=${after}`);
        addEvents(data.items);
        if (data.items.length < 100) break;
        after = data.items.at(-1).id;
      }
    };
    loadTimeline().catch(() => {});
    stream.onmessage = (message) => {
      if (!alive) return;
      const event = JSON.parse(message.data);
      addEvents([event]);
      api(`/jobs/${selectedId}`)
        .then((item) => {
          if (alive) merge([item]);
        })
        .catch(() => {});
      if (terminal(event.status)) stream.close();
    };
    return () => {
      alive = false;
      stream.close();
    };
  }, [selectedId, merge]);
  const create = async (form) => {
    const item = await api("/jobs", { method: "POST", body: form });
    merge([item]);
    select(item);
    return item;
  };
  const action = async (id, verb) => {
    const item = await api(`/jobs/${id}/${verb}`, { method: "POST" });
    merge([item]);
    if (verb !== "cancel" && selection.current === id) select(item);
    return item;
  };
  return {
    jobs,
    selectedId,
    job: jobs.find((item) => item.id === selectedId) || null,
    events: timeline.id === selectedId ? timeline.items : [],
    health,
    error,
    loading,
    select,
    create,
    refresh,
    cancel: (id) => action(id, "cancel"),
    retry: (id) => action(id, "retry"),
    rebuild: (id) => action(id, "rebuild"),
    edit: async (id, document) => {
      const item = await api(`/jobs/${id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(document),
      });
      merge([item]);
      if (selection.current === id) select(item);
      return item;
    },
    check: async () => {
      const h = await api("/runtime/check", { method: "POST" });
      setHealth(h);
      return h;
    },
  };
}
