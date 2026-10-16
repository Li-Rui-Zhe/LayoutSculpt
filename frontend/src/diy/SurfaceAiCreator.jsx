import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useModels } from "../hooks/useModels.js";
import ModelFields from "../components/ModelFields.jsx";

const active = (job) => ["queued", "running"].includes(job?.status);
const labels = {
  queued: "等待生成",
  running: "正在生成",
  succeeded: "生成完成",
  failed: "生成失败",
  cancelled: "已取消",
};

export default function SurfaceAiCreator({ category, onSelection }) {
  const models = useModels({ requiresImage: false });
  const [prompt, setPrompt] = useState(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem(`surface-prompts:v3:${category}`) || "null",
      );
      return typeof stored?.parametric === "string"
        ? stored.parametric
        : localStorage.getItem(`surface-prompt:${category}`) || "";
    } catch {
      return "";
    }
  });
  const [jobs, setJobs] = useState([]),
    [selected, setSelected] = useState(null),
    [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [networkError, setNetworkError] = useState("");
  const lock = useRef(false),
    mounted = useRef(true),
    callback = useRef(onSelection);
  callback.current = onSelection;
  const visibleJobs = jobs.filter((j) => j.method === "parametric");
  const job = visibleJobs.find((j) => j.id === selected) || visibleJobs[0];
  const running = jobs.find(active);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        `surface-prompts:v3:${category}`,
        JSON.stringify({ parametric: prompt }),
      );
    } catch {}
  }, [category, prompt]);
  useEffect(() => {
    callback.current(job || null);
  }, [job?.id, job?.status, job?.result?.id]);
  useEffect(() => {
    let live = true,
      timer;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const list = await api(`/materials/generations?category=${category}`, {
          signal: controller.signal,
        });
        if (live) {
          setJobs(list.items);
          setNetworkError("");
          timer = setTimeout(poll, list.items.some(active) ? 1500 : 8000);
        }
      } catch (e) {
        if (live) {
          setNetworkError(e.message);
          timer = setTimeout(poll, 8000);
        }
      }
    };
    void poll();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [category, revision]);
  const generate = async (event) => {
    event.preventDefault();
    if (lock.current || running || !models.ready || prompt.trim().length < 3)
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api("/materials/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          prompt: prompt.trim(),
          method: "parametric",
          model: models.model || null,
          reasoning_effort: models.effort || null,
        }),
      });
      if (!mounted.current) return;
      setJobs((list) => [result, ...list.filter((j) => j.id !== result.id)]);
      setSelected(result.id);
      setRevision((n) => n + 1);
    } catch (e) {
      if (mounted.current) {
        setError(e.message);
        setRevision((n) => n + 1);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const cancel = async () => {
    if (!running) return;
    try {
      const item = await api(`/materials/generations/${running.id}/cancel`, {
        method: "POST",
      });
      if (mounted.current) {
        setJobs((list) => list.map((j) => (j.id === item.id ? item : j)));
        setRevision((n) => n + 1);
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    }
  };
  const retry = async () => {
    if (lock.current || running || !job) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/materials/generations/${job.id}/retry`, {
        method: "POST",
      });
      if (mounted.current) {
        setJobs((list) => [result, ...list]);
        setSelected(result.id);
        setRevision((n) => n + 1);
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section className="surface-ai-creator" aria-label="AI 材质创作">
      <p className="field-note">
        直接描述材质与质感，无需选择固定类型。AI
        会组合颜色、纤维、颗粒、编织等纹理，并设计光泽与透光效果。
      </p>
      <form onSubmit={generate}>
        <details>
          <summary>模型与推理强度</summary>
          <ModelFields
            models={models}
            purpose="diy"
            idPrefix={`surface-${category}`}
          />
        </details>
        <label className="surface-prompt-label">
          材质描述
          <textarea
            aria-label="AI 材质描述"
            required
            minLength={3}
            maxLength={1500}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              category === "walls"
                ? "例如：自然藤编墙面，细密交织，浅木色，柔和哑光"
                : "例如：米色羊毛地毯，细密短绒，自然色差，柔和哑光"
            }
          />
        </label>
        <div className="surface-ai-examples">
          {(category === "walls"
            ? ["暖白色哑光乳胶漆", "高光透明玻璃", "自然浅木色藤编墙面"]
            : ["米色羊毛短绒地毯", "自然软木颗粒地板", "浅橡木人字拼地板"]
          ).map((text) => (
            <button key={text} type="button" onClick={() => setPrompt(text)}>
              {text}
            </button>
          ))}
        </div>
        <button
          className="primary-button surface-generate-button"
          disabled={
            busy || !!running || !models.ready || prompt.trim().length < 3
          }
        >
          {busy ? "正在提交…" : running ? "正在生成…" : "AI 设计材质"}
        </button>
        {prompt.trim().length < 3 && (
          <small>填写至少 3 个字符的材质描述。</small>
        )}
      </form>
      <p className="surface-parametric-note">
        生成后可调整颜色、纹理密度、光泽和透光效果，再保存到素材库。绒毛和凹凸以平面纹理近似呈现；精确图案可用手绘或上传补充。
      </p>
      {error && <p role="alert">{error}</p>}
      {networkError && <p role="alert">{networkError}</p>}
      {running && (
        <div className="surface-ai-progress">
          <strong>{labels[running.status]}</strong>
          <p>生成完成后自动进入预览，可继续使用其他创作方式。</p>
          <button onClick={cancel}>取消生成</button>
        </div>
      )}
      {job && !active(job) && (
        <div className="surface-ai-result">
          <strong>{labels[job.status]}</strong>
          {["failed", "cancelled"].includes(job.status) && (
            <button disabled={busy || !!running} onClick={retry}>
              按原参数重新生成
            </button>
          )}
          {job.result ? (
            <>
              <p>已显示在右侧预览，调整后可直接保存。</p>
              {job.result.parameters && (
                <p>
                  {job.result.parameters.name} · {job.result.parameters.note}
                </p>
              )}
            </>
          ) : (
            <p role={job.error ? "alert" : undefined}>
              {job.error || "可以修改描述后重新生成。"}
            </p>
          )}
        </div>
      )}
      {!!visibleJobs.length && (
        <details className="surface-ai-history">
          <summary>生成记录 · {visibleJobs.length}</summary>
          {visibleJobs.map((item) => (
            <button
              key={item.id}
              aria-pressed={job?.id === item.id}
              onClick={() => setSelected(item.id)}
            >
              {labels[item.status]} · {item.prompt}
            </button>
          ))}
        </details>
      )}
    </section>
  );
}
