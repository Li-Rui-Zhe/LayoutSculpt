import { InlineProgress } from "../components/LoadingProgress.jsx";
import OperationStatus from "../components/OperationStatus.jsx";
import { useBoundaryLoad } from "../components/ProgressBoundary.jsx";
import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  Monitor,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { api } from "../api.js";
import CodexRuntime from "./CodexRuntime.jsx";
import {
  providerNames as names,
  savedModelId,
  readableModelId,
  hasConnectionChanges,
} from "./connectionState.js";
import "./ai-connections.css";

export default function AiConnections() {
  const [settings, setSettings] = useState(null);
  const [provider, setProvider] = useState("deepseek");
  const [catalog, setCatalog] = useState(null);
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState("");
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const [notice, setNotice] = useState("");
  const [readingModels, setReadingModels] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [modelTest, setModelTest] = useState(null);
  const catalogRequest = useRef(null),
    catalogSequence = useRef(0);
  const request = useRef(null),
    sequence = useRef(0);
  const busy = phase !== "idle";
  const managedLoad = useBoundaryLoad(
    phase === "loading" && !settings,
    "正在读取连接设置",
    !settings ? error : "",
  );
  const selected = catalog?.items.find(
    (item) => item.id === (model || catalog.default_model),
  );
  const configured = settings?.deepseek.configured;
  const changed = hasConnectionChanges(settings, provider, model, key);
  const currentModelId = savedModelId(settings, settings?.default_provider);
  const currentCatalog =
    catalog?.provider === settings?.default_provider ? catalog : null;
  const currentModel = currentCatalog?.items.find(
    (item) => item.id === currentModelId,
  );
  const currentModelLabel = currentModelId
    ? currentModel?.name || readableModelId(currentModelId)
    : currentCatalog?.default_model
      ? `${readableModelId(currentCatalog.default_model)} · 服务默认`
      : settings?.default_provider === "deepseek"
        ? "连接保存后显示实际模型"
        : "跟随本机 Codex 配置";
  const missingModel = Boolean(
    model && catalog && !catalog.items.some((item) => item.id === model),
  );
  const stopCatalogRead = () => {
    ++catalogSequence.current;
    catalogRequest.current?.abort();
    setReadingModels(false);
    setCatalogError("");
  };
  const readSavedCatalog = async (source) => {
    stopCatalogRead();
    const token = catalogSequence.current;
    const controller = new AbortController();
    catalogRequest.current = controller;
    setReadingModels(true);
    try {
      const value = await api(`/models?provider=${source}`, {
        signal: controller.signal,
        timeoutMs: 55000,
      });
      if (token === catalogSequence.current) setCatalog(value);
    } catch (e) {
      if (token === catalogSequence.current) setCatalogError(e.message);
    } finally {
      if (token === catalogSequence.current) setReadingModels(false);
    }
  };
  const applyCatalog = (value, preferred) => {
    setCatalog(value);
    setModel(preferred ?? value?.default_model ?? "");
  };
  const load = async () => {
    const current = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPhase("loading");
    setError("");
    setModelTest(null);
    stopCatalogRead();
    try {
      const value = await api("/ai/settings", { signal: controller.signal });
      if (current !== sequence.current) return;
      setSettings(value);
      const source =
        value.revision > 0
          ? value.default_provider
          : value.codex.available
            ? "codex"
            : "deepseek";
      setProvider(source);
      setKey("");
      setVisible(false);
      setCatalog(null);
      setModel(savedModelId(value, source));
      setReloadNeeded(false);
      setNotice("");
      if (
        source === "deepseek"
          ? value.deepseek.configured
          : value.codex.available
      )
        void readSavedCatalog(source);
    } catch (e) {
      if (current === sequence.current) setError(e.message);
    } finally {
      if (current === sequence.current) setPhase("idle");
    }
  };
  useEffect(() => {
    void load();
    return () => {
      ++sequence.current;
      request.current?.abort();
      ++catalogSequence.current;
      catalogRequest.current?.abort();
    };
  }, []);
  const choose = (value) => {
    if (busy || value === provider) return;
    setProvider(value);
    stopCatalogRead();
    setCatalog(null);
    setModel(savedModelId(settings, value));
    setKey("");
    setVisible(false);
    setError("");
    setNotice("");
    setModelTest(null);
    if (value === "deepseek" ? configured : settings.codex.available)
      void readSavedCatalog(value);
  };
  const send = async (testing = false, removeKey = false) => {
    const current = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPhase(testing ? "testing" : "saving");
    setError("");
    setNotice("");
    setModelTest(null);
    stopCatalogRead();
    try {
      const body = {
        provider: removeKey ? "codex" : provider,
        ...(provider === "deepseek" && key.trim() && !removeKey
          ? { api_key: key.trim() }
          : {}),
        ...(!testing
          ? {
              revision: settings.revision,
              model: model || null,
              ...(removeKey ? { remove_key: true } : {}),
            }
          : {}),
      };
      const value = await api(testing ? "/ai/test" : "/ai/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        timeoutMs: 65000,
      });
      if (current !== sequence.current) return;
      if (testing) {
        applyCatalog(value.catalog, model || undefined);
        setNotice("模型列表已更新。");
      } else {
        applyCatalog(
          value.catalog,
          savedModelId(value, value.default_provider),
        );
        setSettings(value);
        setKey("");
        setVisible(false);
        setReloadNeeded(false);
        if (removeKey) setProvider(value.default_provider);
        setNotice(
          removeKey ? "密钥已移除，默认来源已切换为 Codex。" : "配置已保存。",
        );
        window.dispatchEvent(
          new CustomEvent("habitat:ai-changed", {
            detail: { provider: value.default_provider },
          }),
        );
      }
    } catch (e) {
      if (current !== sequence.current) return;
      const uncertain = !testing && (e.status === 409 || !e.status);
      setReloadNeeded(uncertain);
      setError(
        uncertain
          ? "连接设置可能已保存或被其他页面更新，请先重新读取状态。"
          : e.message,
      );
      if (provider === "codex") {
        try {
          await refreshCodex();
        } catch {}
      }
    } finally {
      if (current === sequence.current) setPhase("idle");
    }
  };
  const testModel = async () => {
    const current = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPhase("testing-model");
    setModelTest(null);
    try {
      const value = await api("/ai/deepseek/test-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "deepseek",
          model: model || null,
          ...(key.trim() ? { api_key: key.trim() } : {}),
        }),
        signal: controller.signal,
        timeoutMs: 55000,
      });
      if (current === sequence.current) {
        const label =
          catalog?.items.find((item) => item.id === value.model)?.name ||
          readableModelId(value.model);
        setModelTest({
          success: true,
          message: `${label} 已成功返回文字回复。`,
        });
      }
    } catch (e) {
      if (current === sequence.current)
        setModelTest({ success: false, message: e.message });
    } finally {
      if (current === sequence.current) setPhase("idle");
    }
  };
  const refreshCodex = async () => {
    const value = await api("/ai/settings");
    setSettings((previous) =>
      previous ? { ...previous, codex: value.codex } : previous,
    );
  };
  const codexReport = settings?.codex.runtime;
  const codexStatus =
    codexReport?.status === "ready"
      ? "已连接"
      : codexReport?.status === "disconnected"
        ? "已断开"
        : codexReport?.action === "login" ||
            codexReport?.code === "authentication"
          ? "待登录"
          : settings?.codex.available
            ? "已安装"
            : "待安装";
  return (
    <section className="ai-connections ai-simple" aria-label="AI 接入设置">
      <header className="ai-page-heading">
        <h1>AI 接入</h1>
        <button className="ai-text-button" disabled={busy} onClick={load}>
          <RefreshCw size={14} />
          刷新状态
        </button>
      </header>
      <div className="ai-settings-body">
        <OperationStatus
          active={phase === "loading" && (!!settings || !managedLoad)}
          failed={!!error}
          background={!!settings}
          label="正在读取连接设置"
          successLabel="连接设置已读取"
        />
        {error && (
          <div className="ai-feedback error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
            {(reloadNeeded || !settings) && (
              <button disabled={busy} onClick={load}>
                重新读取状态
              </button>
            )}
            <button aria-label="关闭接入提示" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {settings?.warning && (
          <p className="ai-feedback warning" role="status">
            {settings.warning}
          </p>
        )}
        {!settings ? (
          <div className="ai-loading" role="status">
            {!busy && "暂时无法读取设置，请重试。"}
          </div>
        ) : (
          <div className="ai-settings-layout">
            <div className="ai-source-column">
              <div
                className="ai-provider-cards"
                role="group"
                aria-label="AI 来源"
              >
                {[
                  ["deepseek", Cloud, configured ? "密钥已保存" : "待配置"],
                  ["codex", Monitor, codexStatus],
                ].map(([id, Icon, status]) => (
                  <button
                    key={id}
                    type="button"
                    disabled={busy}
                    aria-pressed={provider === id}
                    onClick={() => choose(id)}
                    className="ai-provider-card"
                  >
                    <span className="ai-provider-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <span className="ai-provider-label">
                      <strong>{names[id]}</strong>
                      <span>{status}</span>
                    </span>
                  </button>
                ))}
              </div>
              <section
                className="ai-saved-summary"
                aria-label="已保存的 AI 配置"
                data-uncertain={reloadNeeded || undefined}
              >
                <span className="ai-summary-label">
                  {reloadNeeded ? "上次读取的配置" : "新任务默认配置"}
                </span>
                <div className="ai-summary-selection">
                  <strong>{names[settings.default_provider]}</strong>
                  <span className="ai-saved-model">{currentModelLabel}</span>
                  {!reloadNeeded &&
                    settings.default_provider === "codex" &&
                    settings.codex.runtime?.status === "ready" && (
                      <span className="ai-connected-badge">
                        <CheckCircle2 size={13} aria-hidden="true" />
                        已连接
                      </span>
                    )}
                </div>
              </section>
            </div>
            <div className="ai-provider-detail">
              <section
                className="ai-connection-panel"
                aria-labelledby="ai-provider-title"
              >
                <h2 id="ai-provider-title">{names[provider]} 设置</h2>
                <div className="ai-connection-fields">
                  {provider === "deepseek" ? (
                    <div className="ai-deepseek-fields">
                      <div className="ai-key-label">
                        <label htmlFor="ai-api-key">DeepSeek API Key</label>
                        {configured && (
                          <span className="ai-saved-key" role="status">
                            <CheckCircle2 size={13} aria-hidden="true" />
                            已保存{" "}
                            <code>
                              {settings.deepseek.key_hint || "••••••••"}
                            </code>
                          </span>
                        )}
                        <a
                          href="https://platform.deepseek.com/api_keys"
                          target="_blank"
                          rel="noreferrer"
                        >
                          获取密钥
                          <ExternalLink size={12} />
                        </a>
                      </div>
                      <div className="ai-key-input">
                        <KeyRound size={16} />
                        <input
                          id="ai-api-key"
                          type={visible ? "text" : "password"}
                          autoComplete="new-password"
                          spellCheck={false}
                          placeholder={
                            configured
                              ? "留空沿用已保存的密钥"
                              : "粘贴你的 API Key"
                          }
                          value={key}
                          disabled={busy}
                          maxLength={4096}
                          onChange={(e) => {
                            setKey(e.target.value);
                            stopCatalogRead();
                            setCatalog(null);
                            setError("");
                            setNotice("");
                            setModelTest(null);
                          }}
                        />
                        <button
                          type="button"
                          disabled={!key}
                          aria-label={
                            visible ? "隐藏密钥" : "显示本次输入的密钥"
                          }
                          onClick={() => setVisible(!visible)}
                        >
                          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {provider === "deepseek" && configured && (
                        <details className="ai-advanced ai-remove">
                          <summary>密钥管理</summary>
                          <p>移除密钥后，默认来源将切换为 Codex。</p>
                          <button
                            disabled={busy}
                            onClick={() => send(false, true)}
                          >
                            确认移除密钥
                          </button>
                        </details>
                      )}
                    </div>
                  ) : (
                    <CodexRuntime
                      initial={settings.codex.runtime}
                      connection={settings.codex}
                      busy={busy}
                      onPhase={setPhase}
                      onConnect={() => send()}
                      onEnvironment={refreshCodex}
                      onResult={(value, diagnostics, replace) => {
                        if (replace) {
                          stopCatalogRead();
                          applyCatalog(value);
                        }
                        if (diagnostics)
                          setSettings((previous) => ({
                            ...previous,
                            codex: {
                              ...previous.codex,
                              runtime: diagnostics,
                              connected: diagnostics.connected,
                            },
                          }));
                        window.dispatchEvent(
                          new Event("habitat:runtime-changed"),
                        );
                      }}
                    />
                  )}
                  <div className="ai-model-options">
                    <section
                      className="ai-model-picker"
                      aria-label="默认模型设置"
                    >
                      <label htmlFor="ai-default-model">新任务默认模型</label>
                      <div className="ai-model-controls">
                        <select
                          id="ai-default-model"
                          value={model}
                          disabled={busy}
                          onChange={(e) => {
                            setModel(e.target.value);
                            setModelTest(null);
                          }}
                        >
                          <option value="">自动选择</option>
                          {model &&
                            !catalog?.items.some(
                              (item) => item.id === model,
                            ) && (
                              <option value={model}>
                                {readableModelId(model)}
                                {catalog ? " · 当前目录未返回" : ""}
                              </option>
                            )}
                          {catalog?.items.map((item) => (
                            <option
                              key={item.id}
                              value={item.id}
                              disabled={item.available === false}
                            >
                              {item.name}
                              {item.available === false
                                ? " · 不可用"
                                : item.supports_image === true
                                  ? " · 支持识图"
                                  : item.supports_image === false
                                    ? " · 仅文字"
                                    : ""}
                            </option>
                          ))}
                        </select>
                        <button
                          className="ai-text-button"
                          disabled={
                            busy ||
                            readingModels ||
                            (provider === "deepseek" &&
                              !configured &&
                              !key.trim())
                          }
                          onClick={() => send(true)}
                        >
                          <RefreshCw size={14} />
                          {readingModels || phase === "testing"
                            ? "正在读取…"
                            : "刷新模型"}
                        </button>
                      </div>
                      {catalogError && (
                        <p className="ai-catalog-error">{catalogError}</p>
                      )}
                      {missingModel && (
                        <p className="ai-catalog-error">
                          所选模型已不在列表中，请重新选择。
                        </p>
                      )}
                    </section>
                    {provider === "deepseek" && (
                      <section
                        className="ai-model-test"
                        aria-labelledby="ai-model-test-title"
                      >
                        <p id="ai-model-test-title">
                          可选测试 · 使用少量 API 额度
                        </p>
                        <button
                          type="button"
                          className="ai-model-test-button"
                          disabled={
                            busy ||
                            missingModel ||
                            selected?.available === false ||
                            (!configured && !key.trim())
                          }
                          onClick={testModel}
                        >
                          {phase === "testing-model" ? "正在测试…" : "测试模型"}
                        </button>
                        <div
                          className="ai-model-test-status"
                          role="status"
                          aria-atomic="true"
                        >
                          {modelTest && (
                            <p
                              className={
                                modelTest.success ? "success" : "error"
                              }
                            >
                              {modelTest.success ? (
                                <CheckCircle2 size={16} aria-hidden="true" />
                              ) : (
                                <AlertCircle size={16} aria-hidden="true" />
                              )}
                              <span>{modelTest.message}</span>
                            </p>
                          )}
                        </div>
                      </section>
                    )}
                  </div>
                  {notice && (
                    <div className="ai-feedback success" role="status">
                      <CheckCircle2 size={17} />
                      <span>{notice}</span>
                      <button
                        aria-label="关闭成功提示"
                        onClick={() => setNotice("")}
                      >
                        ×
                      </button>
                    </div>
                  )}
                  <footer className="ai-save-row">
                    {changed && (
                      <span className="ai-unsaved-note" role="status">
                        修改尚未保存
                      </span>
                    )}
                    <button
                      className="primary-button"
                      disabled={
                        busy ||
                        reloadNeeded ||
                        missingModel ||
                        selected?.available === false ||
                        (provider === "deepseek" &&
                          !configured &&
                          !key.trim()) ||
                        (provider === "codex" && !settings.codex.available)
                      }
                      onClick={() => send()}
                    >
                      <InlineProgress
                        active={phase === "saving"}
                        failed={!!error}
                        fallback={<ArrowRight size={16} />}
                      />{" "}
                      {phase === "saving"
                        ? "正在连接并保存…"
                        : `${settings.revision > 0 ? "保存并使用" : "连接并使用"} ${names[provider]}`}
                    </button>
                  </footer>
                </div>
              </section>
              <p className="ai-data-note">
                设计描述和图片会发送给所选 AI 服务。
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
