import { useCallback, useEffect, useRef, useState } from "react";
import { projectGroups } from "../projects.js";
import { api, terminal } from "../api.js";
import { readContext, writeContext } from "./urlContext.js";
import {
  operationKey,
  finishOperation,
  formSignature,
} from "./operationKeys.js";

// 列表是任务状态的唯一来源；异步响应只更新自己的任务，不能改变当前选择。
export function useProjects() {
  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState(() => {
    try {
      return readContext(
        "project",
        localStorage.getItem("habitat-job") || "sample",
      );
    } catch {
      return "sample";
    }
  });
  const [timeline, setTimeline] = useState({ id: null, items: [] });
  const [metadata, setMetadata] = useState([]);
  const healthTime = useRef(0);
  const healthSnapshot = useRef(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const selectedActive = jobs.some(
    (item) => item.id === selectedId && !terminal(item.status),
  );
  const selection = useRef(selectedId);
  useEffect(() => writeContext({ project: selectedId }), [selectedId]);
  const listRequest = useRef(0);
  const activeRefresh = useRef(0);
  const changesCursor = useRef("");
  const initialized = useRef(false);
  const [historyBefore, setHistoryBefore] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyLock = useRef(false);
  const changes = async () => {
    if (!initialized.current)
      return { ...(await api("/jobs/page")), initial: true };
    let cursor = changesCursor.current,
      items = [],
      page;
    do {
      page = await api(`/jobs/changes?cursor=${encodeURIComponent(cursor)}`);
      items.push(...page.items);
      cursor = page.cursor;
    } while (page.more);
    return { items, cursor };
  };
  const merge = useCallback((items) => {
    setJobs((previous) => {
      if (!items.length) return previous;
      const map = new Map(previous.map((item) => [item.id, item]));
      let changed = false;
      for (const item of items) {
        const old = map.get(item.id);
        if (
          !old ||
          (Date.parse(item.updated_at) >= Date.parse(old.updated_at) &&
            JSON.stringify(old) !== JSON.stringify(item))
        ) {
          map.set(item.id, item);
          changed = true;
        }
      }
      if (!changed) return previous;
      return [...map.values()].sort(
        (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
      );
    });
  }, []);
  const refresh = useCallback(async () => {
    const token = ++listRequest.current;
    activeRefresh.current = token;
    try {
      const checkedHealth =
        !healthSnapshot.current || Date.now() - healthTime.current > 30000;
      let [h, j, m] = await Promise.allSettled([
        checkedHealth ? api("/health") : Promise.resolve(null),
        changes(),
        api("/project-metadata"),
      ]);
      if (token !== listRequest.current) return;
      // A failed task read is not proof that the whole workbench is offline.
      // Recheck cached health on a read failure so a real outage is still detected.
      if (
        !checkedHealth &&
        (j.status === "rejected" || m.status === "rejected")
      ) {
        [h] = await Promise.allSettled([api("/health")]);
        if (token !== listRequest.current) return;
      }
      if (h.status === "fulfilled" && h.value) {
        healthSnapshot.current = h.value;
        setHealth((old) =>
          JSON.stringify(old) === JSON.stringify(h.value) ? old : h.value,
        );
        healthTime.current = Date.now();
      } else if (h.status === "rejected") {
        healthSnapshot.current = null;
        healthTime.current = 0;
        setHealth(null);
      }
      if (m.status === "fulfilled") {
        setMetadata((old) =>
          JSON.stringify(old) === JSON.stringify(m.value.items)
            ? old
            : m.value.items,
        );
      }
      if (j.status === "fulfilled") {
        if (j.value.initial) {
          initialized.current = true;
          setHistoryBefore(j.value.before);
        }
        changesCursor.current = j.value.cursor;
        merge(j.value.items);
      }
      const failed = [
        j.status === "rejected" && "任务记录",
        m.status === "rejected" && "项目信息",
      ].filter(Boolean);
      setError(
        !healthSnapshot.current
          ? "工作台未连接，任务记录将在连接恢复后同步。"
          : failed.length
            ? `${failed.join("和")}暂时无法同步，请重试。当前页面内容仍保留。`
            : "",
      );
    } catch {
      if (token !== listRequest.current) return;
      healthTime.current = 0;
      setError("任务同步出现异常，请重试。当前页面内容仍保留。");
    } finally {
      if (token === listRequest.current) {
        activeRefresh.current = 0;
        setLoading(false);
      }
    }
  }, [merge]);
  const recheck = useCallback(() => {
    healthTime.current = 0;
    return refresh();
  }, [refresh]);
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden && !activeRefresh.current) refresh();
    }, 12000);
    return () => {
      clearInterval(timer);
      listRequest.current += 1;
    };
  }, [refresh]);
  useEffect(() => {
    const changed = () => {
      if (!document.hidden) void recheck();
    };
    window.addEventListener("habitat:ai-changed", changed);
    window.addEventListener("habitat:runtime-changed", changed);
    window.addEventListener("focus", changed);
    window.addEventListener("online", changed);
    document.addEventListener("visibilitychange", changed);
    return () => {
      window.removeEventListener("habitat:ai-changed", changed);
      window.removeEventListener("habitat:runtime-changed", changed);
      window.removeEventListener("focus", changed);
      window.removeEventListener("online", changed);
      document.removeEventListener("visibilitychange", changed);
    };
  }, [recheck]);
  const select = useCallback((item) => {
    const id = item?.id || "sample";
    selection.current = id;
    setSelectedId(id);
    writeContext({ project: id, object: null, room: null, tab: null });
    try {
      localStorage.setItem("habitat-job", id);
    } catch {
      /* Current selection still works without persistence. */
    }
  }, []);
  useEffect(() => {
    const restore = () => {
      const id = readContext("project", "sample");
      selection.current = id;
      setSelectedId(id);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
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
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        refresh();
        return;
      }
      addEvents([event]);
      api(`/jobs/${selectedId}`)
        .then((item) => {
          if (alive) {
            merge([item]);
            if (terminal(item.status)) stream.close();
          }
        })
        .catch(() => {});
    };
    return () => {
      alive = false;
      stream.close();
    };
  }, [selectedId, selectedActive, merge, refresh]);
  const create = async (form, importing = false) => {
    const signature = await formSignature(form);
    const type = importing ? "import" : "create";
    const item = await api(importing ? "/projects/import" : "/jobs", {
      method: "POST",
      body: form,
      headers: { "Idempotency-Key": operationKey(type, signature) },
    });
    finishOperation(type);
    merge([item]);
    select(item);
    return item;
  };
  const action = async (id, verb, changes) => {
    const type = `${id}:${verb}`;
    const item = await api(`/jobs/${id}/${verb}`, {
      method: "POST",
      headers: {
        "Idempotency-Key": operationKey(type, JSON.stringify(changes || {})),
        ...(changes ? { "Content-Type": "application/json" } : {}),
      },
      ...(changes
        ? {
            body: JSON.stringify(changes),
          }
        : {}),
    });
    finishOperation(type);
    merge([item]);
    if (verb !== "cancel" && selection.current === id) select(item);
    return item;
  };
  const groups = projectGroups(
    jobs.map((j) => ({
      ...j,
      ...(metadata.find((m) => m.job_id === j.id) || {}),
    })),
  );
  const enriched = groups
    .flatMap((g) => g.versions)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const changeMetadata = async (id, value) => {
    await api(`/jobs/${id}/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    await refresh();
  };
  const loadMore = async () => {
    if (!historyBefore || historyLock.current) return;
    historyLock.current = true;
    setHistoryLoading(true);
    try {
      const page = await api(
        `/jobs/page?before=${encodeURIComponent(historyBefore)}`,
      );
      merge(page.items);
      setHistoryBefore(page.before);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      historyLock.current = false;
      setHistoryLoading(false);
    }
  };
  return {
    hasMoreHistory: !!historyBefore,
    historyLoading,
    loadMore,
    jobs: enriched,
    groups,
    changeMetadata,
    archiveProject: async (id, archived) => {
      const result = await api(`/projects/${id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      await refresh();
      return result;
    },
    selectedId,
    job: enriched.find((item) => item.id === selectedId) || null,
    events: timeline.id === selectedId ? timeline.items : [],
    health,
    error,
    loading,
    select,
    create,
    importProject: (form) => create(form, true),
    refresh,
    recheck,
    cancel: (id) => action(id, "cancel"),
    continue: (id, changes) => action(id, "continue", changes),
    retry: (id, changes) => action(id, "retry", changes),
    rebuild: (id) => action(id, "rebuild"),
    refine: (id) => action(id, "rebuild?replan=true"),
    restructure: (id) => action(id, "rebuild?restructure=true"),
    confirmStructure: async (id, document) => {
      const item = await api(`/jobs/${id}/confirm-structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(document),
      });
      merge([item]);
      return item;
    },
    reviewRecognition: async (id) => {
      const item = await api(`/jobs/${id}/recognition-review`, {
        method: "POST",
      });
      merge([item]);
      return item;
    },
    edit: async (id, document, { selectResult = true } = {}) => {
      const item = await api(`/jobs/${id}/edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": operationKey(
            `edit:${id}`,
            JSON.stringify(document),
          ),
        },
        body: JSON.stringify(document),
      });
      finishOperation(`edit:${id}`);
      merge([item]);
      if (selectResult && selection.current === id) select(item);
      return item;
    },
    check: async () => {
      const h = await api("/runtime/check", { method: "POST" });
      setHealth(h);
      return h;
    },
  };
}
