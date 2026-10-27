import { InlineProgress } from "../components/LoadingProgress.jsx";
import OperationStatus from "../components/OperationStatus.jsx";
import { useBoundaryLoad } from "../components/ProgressBoundary.jsx";
import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  Monitor,
  Check,
  ShieldCheck,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  ExternalLink,
  ArrowRight,
  PlugZap,
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
    stopCatalogRead();
    try {
      const value = await api("/ai/settings", { signal: controller.signal });
      if (current !== sequence.current) return;
      setSettings(value);
      const source = value.revision > 0 ? value.default_provider : "deepseek";
      setProvider(source);
      setKey("");
      setVisible(false);
      setCatalog(null);
      setModel(savedModelId(value, source));
      setReloadNeeded(false);
      setNotice("");
      if (
        value.revision > 0 &&
        (source === "deepseek"
          ? value.deepseek.configured
          : value.codex.available)
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
        setNotice(
          "连接检测通过，可在下方选择模型；点击连接按钮后保存。持续生成仍需账户有可用权限和额度。",
        );
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
          removeKey
            ? "已移除 DeepSeek 密钥。默认来源已切回 Codex，使用前请确认连接可用。"
            : `已保存 ${names[value.default_provider]} · ${readableModelId(savedModelId(value, value.default_provider))}。新任务将使用此配置。`,
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
  const refreshCodex = async () => {
    const value = await api("/ai/settings");
    setSettings((previous) =>
      previous ? { ...previous, codex: value.codex } : previous,
    );
  };
  return (
    <section className="ai-connections ai-simple" aria-label="AI 接入设置">
      <header className="ai-page-heading">
        <div className="ai-page-title">
          <span className="ai-page-icon">
            <PlugZap size={25} />
          </span>
          <div>
            <span className="ai-eyebrow">连接创作能力</span>
            <h1>让 AI 加入你的设计</h1>
            <p>选一种接入方式，连接一次，之后直接使用。</p>
          </div>
        </div>
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
        {settings && (
          <section
            className="ai-saved-summary"
            aria-label="已保存的 AI 配置"
            data-uncertain={reloadNeeded || undefined}
          >
            <div className="ai-summary-heading">
              <strong>
                <CheckCircle2 size={16} />{" "}
                {reloadNeeded
                  ? "上次读取的配置"
                  : settings.revision > 0
                    ? "当前已保存配置"
                    : "当前默认配置"}
              </strong>
              <span>
                {reloadNeeded
                  ? "请重新读取确认"
                  : settings.revision > 0
                    ? "已保存到本机"
                    : "尚未完成设置"}
              </span>
            </div>
            <dl>
              <div>
                <dt>新任务默认来源</dt>
                <dd>{names[settings.default_provider]}</dd>
              </div>
              <div>
                <dt>当前默认模型</dt>
                <dd className="ai-saved-model">{currentModelLabel}</dd>
                {currentModelId &&
                  currentModel?.name &&
                  currentModel.name !== readableModelId(currentModelId) && (
                    <dd className="ai-saved-model-id">
                      {readableModelId(currentModelId)}
                    </dd>
                  )}
              </div>
              <div>
                <dt>DeepSeek 密钥</dt>
                <dd className="ai-saved-key">
                  <KeyRound size={15} />
                  {configured ? (
                    <>
                      <span>已保存</span>
                      <code>{settings.deepseek.key_hint || "••••••••"}</code>
                    </>
                  ) : (
                    "未配置"
                  )}
                </dd>
              </div>
            </dl>
            <p>
              {reloadNeeded
                ? "连接设置可能已保存或被其他页面更新，请重新读取状态后确认当前配置。"
                : settings.revision > 0
                  ? "新任务默认使用以上配置；已有任务保留各自的来源和模型。"
                  : "连接并保存后，新任务会使用你选择的来源和模型。"}
            </p>
          </section>
        )}
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
          <>
            <div
              className="ai-provider-cards"
              role="group"
              aria-label="AI 来源"
            >
              {[
                [
                  "deepseek",
                  Cloud,
                  "简单接入 · 推荐",
                  "粘贴 API Key，一键连接",
                  "不用安装 CLI，适合先开始文字设计",
                ],
                [
                  "codex",
                  Monitor,
                  "进阶接入",
                  "已有 Codex？直接复用",
                  "也可以让项目准备独立环境",
                ],
              ].map(([id, Icon, badge, title, sub]) => (
                <button
                  key={id}
                  disabled={busy}
                  aria-pressed={provider === id}
                  onClick={() => choose(id)}
                  className="ai-provider-card"
                >
                  <span className={`ai-provider-icon ${id}`}>
                    <Icon size={25} />
                  </span>
                  <div>
                    <span className="ai-choice-badge">{badge}</span>
                    <strong>{names[id]}</strong>
                    <p>{title}</p>
                    <span>{sub}</span>
                  </div>
                  <i className="ai-radio">
                    {provider === id && <Check size={12} />}
                  </i>
                </button>
              ))}
            </div>
            <div className="ai-settings-layout">
              <div className="ai-connection-panel">
                <div className="ai-panel-heading">
                  <div>
                    <h2>
                      {provider === "deepseek"
                        ? configured
                          ? "管理 DeepSeek 连接"
                          : "填写密钥，就能开始"
                        : "连接你的 Codex"}
                    </h2>
                  </div>
                  <span>
                    {provider === "deepseek" ? "无需安装" : "进阶使用"}
                  </span>
                </div>
                {provider === "deepseek" ? (
                  <div className="ai-deepseek-fields">
                    <div className="ai-key-label">
                      <label htmlFor="ai-api-key">DeepSeek API Key</label>
                      <a
                        href="https://platform.deepseek.com/api_keys"
                        target="_blank"
                        rel="noreferrer"
                      >
                        获取密钥
                        <ExternalLink size={12} />
                      </a>
                    </div>
                    {configured && (
                      <div className="ai-key-saved" role="status">
                        <ShieldCheck size={17} />
                        <strong>密钥已保存</strong>
                        <code>{settings.deepseek.key_hint || "••••••••"}</code>
                        <span>本机加密 · 无需重复填写</span>
                      </div>
                    )}
                    <div className="ai-key-input">
                      <KeyRound size={16} />
                      <input
                        id="ai-api-key"
                        type={visible ? "text" : "password"}
                        autoComplete="new-password"
                        spellCheck={false}
                        placeholder={
                          configured
                            ? "需要更换密钥时再填写，留空保留已保存密钥"
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
                        }}
                      />
                      <button
                        type="button"
                        disabled={!key}
                        aria-label={visible ? "隐藏密钥" : "显示本次输入的密钥"}
                        onClick={() => setVisible(!visible)}
                      >
                        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <p className="ai-field-help">
                      <ShieldCheck size={13} />{" "}
                      {configured
                        ? "已有密钥保存在本机，可直接连接。"
                        : "密钥加密保存在本机，保存后仅显示脱敏标识。"}{" "}
                      直连 DeepSeek 官方 API，按你的账户计费。
                    </p>
                    <div className="ai-fit-note">
                      <p>
                        文字家具、墙面与地板设计可直接开始。上传户型或参考图片，需要模型支持图片理解。
                      </p>
                    </div>
                  </div>
                ) : (
                  <CodexRuntime
                    initial={settings.codex.runtime}
                    connection={settings.codex}
                    busy={busy}
                    onPhase={setPhase}
                    onConnect={() => send()}
                    onEnvironment={refreshCodex}
                    onAlternative={() => choose("deepseek")}
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
                <section className="ai-model-picker" aria-label="默认模型设置">
                  <div className="ai-model-heading">
                    <label htmlFor="ai-default-model">新任务默认模型</label>
                    <span className={changed ? "pending" : "saved"}>
                      {changed
                        ? "本次选择 · 尚未保存"
                        : settings.revision > 0
                          ? "已保存"
                          : "连接后生效"}
                    </span>
                  </div>
                  <div className="ai-model-controls">
                    <select
                      id="ai-default-model"
                      value={model}
                      disabled={busy}
                      onChange={(e) => setModel(e.target.value)}
                    >
                      <option value="">自动选择（保存后显示实际模型）</option>
                      {model &&
                        !catalog?.items.some((item) => item.id === model) && (
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
                              : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      className="ai-text-button"
                      disabled={
                        busy ||
                        readingModels ||
                        (provider === "deepseek" && !configured && !key.trim())
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
                    <p className="ai-catalog-error">
                      {catalogError} 已保存配置仍显示在上方，可稍后刷新模型。
                    </p>
                  )}
                  {missingModel && (
                    <p className="ai-catalog-error">
                      所选模型未在当前目录中找到，请选择可用模型后保存。上方已保存配置不变。
                    </p>
                  )}
                  <p className="ai-field-help">
                    先选择模型，再点击保存。只读取模型列表不会产生生成任务。
                  </p>
                </section>
                {selected && (
                  <p className="ai-capability-note">
                    本次选择：{selected.name} ·{" "}
                    {selected.supports_image === true
                      ? "支持文字设计与识图（非图片生成）"
                      : selected.supports_image === false
                        ? "仅支持文字输入，上传户型图请切换图片模型"
                        : "识图能力尚未确认，上传图片前需检查"}
                  </p>
                )}
                {settings.revision > 0 && changed && (
                  <p className="ai-unsaved-note" role="status">
                    修改尚未保存。当前新任务仍默认使用{" "}
                    {names[settings.default_provider]} · {currentModelLabel}。
                  </p>
                )}
                <footer className="ai-save-row">
                  <span>
                    {settings.revision > 0 && !changed
                      ? "当前配置已保存，可直接开始设计"
                      : "保存后，新任务将使用本次选择的来源和模型"}
                  </span>
                  <button
                    className="primary-button"
                    disabled={
                      busy ||
                      reloadNeeded ||
                      missingModel ||
                      selected?.available === false ||
                      (provider === "deepseek" && !configured && !key.trim()) ||
                      (provider === "codex" && !settings.codex.available)
                    }
                    onClick={() => send()}
                  >
                    <InlineProgress
                      active={busy}
                      failed={!!error}
                      fallback={<ArrowRight size={16} />}
                    />{" "}
                    {phase === "saving"
                      ? "正在连接并保存…"
                      : `${settings.revision > 0 ? "保存并使用" : "连接并使用"} ${names[provider]}`}
                  </button>
                </footer>
                {provider === "deepseek" && configured && (
                  <details className="ai-advanced ai-remove">
                    <summary>密钥管理</summary>
                    <p>
                      删除本机密钥并切回 Codex，已有设计保留；Codex
                      需要另行连接。
                    </p>
                    <button disabled={busy} onClick={() => send(false, true)}>
                      确认移除密钥
                    </button>
                  </details>
                )}
              </div>
              <aside className="ai-settings-guide">
                <div className="ai-guide-block">
                  <span className="ai-guide-icon">
                    <Cloud size={22} />
                  </span>
                  <h2>怎么选更省事？</h2>
                  <p>
                    <strong>想快速开始</strong>
                    <br />选 DeepSeek API，填密钥后直接连接。
                  </p>
                  <p>
                    <strong>电脑已有 Codex</strong>
                    <br />选 Codex，检测通过后沿用现有登录与配置。
                  </p>
                  <p>
                    <strong>想独立管理环境</strong>
                    <br />在 Codex 更多设置中准备项目专用版本，首次单独登录。
                  </p>
                </div>
                <div className="ai-guide-block ai-privacy">
                  <ShieldCheck size={18} />
                  <p>
                    生成所需的描述和图片会发送给你选择的 AI
                    服务。失败时不会自动换用另一家服务。
                  </p>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
