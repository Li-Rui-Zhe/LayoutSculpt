import { useEffect, useRef, useState } from "react";
import {
  PlugZap,
  Monitor,
  Cloud,
  Check,
  ShieldCheck,
  Eye,
  EyeOff,
  RefreshCw,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
  Image,
  Layers,
  Armchair,
  ScanLine,
  ChevronRight,
  KeyRound,
  ExternalLink,
} from "lucide-react";
import { api } from "../api.js";
import { chooseModel } from "../hooks/modelSelection.js";
import CodexRuntime from "./CodexRuntime.jsx";
import "./ai-connections.css";

const names = { codex: "本机 Codex", deepseek: "DeepSeek API" };

export default function AiConnections() {
  const [settings, setSettings] = useState(null);
  const [provider, setProvider] = useState("codex");
  const [catalog, setCatalog] = useState(null);
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState("");
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const [notice, setNotice] = useState("");
  const [remove, setRemove] = useState(false);
  const request = useRef(null),
    sequence = useRef(0);
  const busy = [
    "loading",
    "testing",
    "saving",
    "checking",
    "installing",
  ].includes(phase);
  const selected = catalog?.items.find((item) => item.id === model);
  const configured = settings?.deepseek.configured;

  const load = async () => {
    const current = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPhase("loading");
    setReloadNeeded(false);
    setError("");
    try {
      const value = await api("/ai/settings", { signal: controller.signal });
      if (current !== sequence.current) return;
      setSettings(value);
      setProvider(value.default_provider);
      setKey("");
      setVisible(false);
      setCatalog(null);
      setNotice("");
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
    };
  }, []);

  const chooseProvider = (value) => {
    if (value === provider) return;
    setProvider(value);
    setCatalog(null);
    setModel("");
    setKey("");
    setVisible(false);
    setError("");
    setNotice("");
    setRemove(false);
  };
  const applyCatalog = (value) => {
    setCatalog(value);
    const preferred = settings?.[provider]?.default_model;
    setModel(
      value
        ? chooseModel(
            value,
            provider === "deepseek" && preferred
              ? `deepseek::${preferred}`
              : preferred,
            false,
          )
        : "",
    );
  };
  const send = async (path, body, saving = false) => {
    const current = ++sequence.current;
    const controller = new AbortController();
    request.current = controller;
    setPhase(saving ? "saving" : "testing");
    setReloadNeeded(false);
    setError("");
    setNotice("");
    try {
      const value = await api(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        timeoutMs: 65000,
      });
      if (current !== sequence.current) return;
      if (saving) {
        setSettings(value);
        setKey("");
        setVisible(false);
        setRemove(false);
        setProvider(value.default_provider);
        if (body.remove_key) {
          setCatalog(null);
          setModel("");
        }
        setNotice(
          body.remove_key
            ? "已移除 DeepSeek 连接，默认来源已切回本机 Codex。"
            : `已保存，后续新任务默认使用${names[value.default_provider]}。`,
        );
        window.dispatchEvent(
          new CustomEvent("habitat:ai-changed", {
            detail: { provider: value.default_provider },
          }),
        );
      } else {
        applyCatalog(value.catalog);
        setNotice(value.message);
      }
    } catch (e) {
      if (current === sequence.current) {
        setError(e.message);
        setReloadNeeded(saving && (e.status === 409 || !e.status));
        if (!saving) setCatalog(null);
      }
    } finally {
      if (current === sequence.current) setPhase("idle");
    }
  };
  const test = () =>
    send("/ai/test", {
      provider,
      ...(provider === "deepseek" && key.trim() ? { api_key: key.trim() } : {}),
    });
  const save = () =>
    send(
      "/ai/settings",
      {
        provider,
        revision: settings.revision,
        model,
        ...(provider === "deepseek" && key.trim()
          ? { api_key: key.trim() }
          : {}),
      },
      true,
    );
  const cancelTest = () => {
    ++sequence.current;
    request.current?.abort();
    setPhase("idle");
    setNotice("已取消本次连接检测，已保存的设置没有改变。");
  };

  return (
    <section className="ai-connections" aria-label="AI 接入设置">
      <header className="ai-page-heading">
        <div className="ai-page-title">
          <span className="ai-page-icon">
            <PlugZap size={25} strokeWidth={1.6} />
          </span>
          <div>
            <span className="ai-eyebrow">AI CONNECTIONS</span>
            <h1>AI 接入</h1>
            <p>选一个顺手的 AI，让灵感接着发生。</p>
          </div>
        </div>
        <button className="secondary-button" disabled={busy} onClick={load}>
          <RefreshCw size={14} />
          刷新状态
        </button>
      </header>

      <div className="ai-settings-body">
        <div className="ai-current-source">
          <span className="ai-online-dot" />
          <span>当前默认来源</span>
          <strong>
            {settings ? names[settings.default_provider] : "正在读取…"}
          </strong>
          <span className="ai-current-note">
            用于新建任务，已有任务保留原模型
          </span>
        </div>
        {settings?.warning && (
          <div className="ai-feedback warning" role="status">
            <AlertCircle size={17} />
            {settings.warning}
          </div>
        )}
        {error && (
          <div className="ai-feedback error" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button
              disabled={busy}
              onClick={reloadNeeded || !settings ? load : test}
            >
              {reloadNeeded ? "刷新设置" : "重试"}
            </button>
          </div>
        )}
        {!settings && (
          <div className="ai-loading" role="status">
            {phase === "loading" ? (
              <>
                <LoaderCircle size={20} className="spin" />
                正在读取本机连接设置…
              </>
            ) : (
              "连接设置尚未读取成功，请重试。"
            )}
          </div>
        )}
        {settings && (
          <>
            <div className="ai-section-label">
              <h2>选择 AI 来源</h2>
              <span>同一套设计流程，两种连接方式</span>
            </div>
            <div
              className="ai-provider-cards"
              role="group"
              aria-label="AI 来源"
            >
              {[
                [
                  "codex",
                  Monitor,
                  "沿用本机登录和模型配置",
                  "无需额外填写密钥",
                ],
                [
                  "deepseek",
                  Cloud,
                  "使用你自己的 DeepSeek API",
                  "直连官方服务，按账户计费",
                ],
              ].map(([id, Icon, title, sub]) => (
                <button
                  key={id}
                  disabled={busy}
                  aria-pressed={provider === id}
                  onClick={() => chooseProvider(id)}
                  className="ai-provider-card"
                >
                  <span className={`ai-provider-icon ${id}`}>
                    <Icon size={25} strokeWidth={1.5} />
                  </span>
                  <div>
                    <strong>
                      {names[id]}
                      {settings.default_provider === id && (
                        <small>当前默认</small>
                      )}
                    </strong>
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
                    <span className="ai-step">01</span>
                    <h2>配置连接</h2>
                  </div>
                  <span>{names[provider]}</span>
                </div>
                {provider === "codex" ? (
                  <CodexRuntime
                    initial={settings.codex.runtime}
                    busy={busy}
                    onPhase={setPhase}
                    onAlternative={
                      configured ? () => chooseProvider("deepseek") : undefined
                    }
                    onResult={(nextCatalog, diagnostics, replace) => {
                      window.dispatchEvent(
                        new Event("habitat:runtime-changed"),
                      );
                      if (replace) applyCatalog(nextCatalog);
                      if (diagnostics)
                        setSettings((previous) => ({
                          ...previous,
                          codex: {
                            ...previous.codex,
                            connected: diagnostics.connected,
                            runtime: diagnostics,
                          },
                        }));
                      setError("");
                      setNotice("");
                    }}
                  />
                ) : (
                  <div className="ai-deepseek-fields">
                    <label htmlFor="ai-endpoint">
                      服务地址<span>DeepSeek 官方</span>
                    </label>
                    <div className="ai-endpoint">
                      <Cloud size={15} />
                      <input
                        id="ai-endpoint"
                        readOnly
                        value={settings.deepseek.base_url}
                      />
                    </div>
                    <div className="ai-key-label">
                      <label htmlFor="ai-api-key">API Key</label>
                      {configured && (
                        <span>
                          <ShieldCheck size={12} />
                          已有加密密钥
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
                            ? "留空则继续使用已保存的密钥"
                            : "粘贴你的 DeepSeek API Key"
                        }
                        value={key}
                        disabled={busy}
                        maxLength={4096}
                        onChange={(e) => {
                          setKey(e.target.value);
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
                      已保存的密钥不会回显。更换密钥后，请重新测试连接。
                    </p>
                  </div>
                )}

                {provider === "deepseek" && (
                  <div className="ai-test-row">
                    <button
                      className="secondary-button"
                      disabled={
                        busy ||
                        (provider === "deepseek" && !configured && !key.trim())
                      }
                      onClick={test}
                    >
                      {phase === "testing" ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        <PlugZap size={15} />
                      )}
                      {phase === "testing"
                        ? "正在检测连接…"
                        : "测试连接并读取模型"}
                    </button>
                    {phase === "testing" ? (
                      <button className="ai-text-button" onClick={cancelTest}>
                        取消检测
                      </button>
                    ) : (
                      <small>仅读取模型，不提交生成任务</small>
                    )}
                  </div>
                )}
                {notice && (
                  <div className="ai-feedback success" role="status">
                    <CheckCircle2 size={17} />
                    {notice}
                  </div>
                )}

                <div className="ai-model-section">
                  <div className="ai-panel-heading">
                    <div>
                      <span className="ai-step">02</span>
                      <h2>选择默认模型</h2>
                    </div>
                    {catalog && <span>{catalog.items.length} 个可用模型</span>}
                  </div>
                  {catalog ? (
                    <>
                      <label htmlFor="ai-default-model">默认生成模型</label>
                      <select
                        id="ai-default-model"
                        value={model}
                        disabled={busy}
                        onChange={(e) => setModel(e.target.value)}
                      >
                        {catalog.items.map((item) => (
                          <option
                            key={item.id}
                            value={item.id}
                            disabled={item.available === false}
                          >
                            {item.name}
                            {item.available === false
                              ? " · 不可用"
                              : item.supports_image
                                ? " · 支持图片"
                                : " · 文字模型"}
                          </option>
                        ))}
                      </select>
                      <div className="ai-model-capabilities">
                        <span>
                          <CheckCircle2 size={14} />
                          文字设计
                        </span>
                        <span
                          className={
                            selected?.supports_image === false
                              ? "unsupported"
                              : ""
                          }
                        >
                          <Image size={14} />
                          {selected?.supports_image === false
                            ? "仅文字输入"
                            : "支持参考图片"}
                        </span>
                      </div>
                      {selected?.supports_image === false && (
                        <p className="ai-capability-note">
                          此模型可用于无参考图的家具和材质设计。户型识别、图片参考和结构复核需要选择支持图片理解的模型。
                        </p>
                      )}
                      {catalog.notice && (
                        <p className="ai-field-help">{catalog.notice}</p>
                      )}
                    </>
                  ) : (
                    <div className="ai-model-placeholder">
                      <Layers size={20} strokeWidth={1.4} />
                      <span>先测试连接，再从实际可用的模型中选择</span>
                    </div>
                  )}
                </div>
                <footer className="ai-save-row">
                  <span>
                    {provider === settings.default_provider
                      ? "修改后保存，新的设置才会生效"
                      : `保存后，将默认使用${names[provider]}`}
                  </span>
                  <button
                    className="primary-button"
                    disabled={busy || !selected || selected.available === false}
                    onClick={save}
                  >
                    {phase === "saving" ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Check size={15} />
                    )}
                    {phase === "saving" ? "正在验证并保存…" : "保存并设为默认"}
                  </button>
                </footer>
              </div>

              <aside className="ai-settings-guide">
                <div className="ai-guide-block">
                  <span className="ai-guide-icon">
                    <Layers size={20} />
                  </span>
                  <h2>一次接入，贯穿设计流程</h2>
                  <p>来源可随任务选择，熟悉的工作流保持一致。</p>
                  <ul>
                    {[
                      [
                        ScanLine,
                        "户型识别与结构核对",
                        "使用支持图片理解的模型",
                      ],
                      [Armchair, "家具 DIY", "描述创意，生成可编辑家具"],
                      [Layers, "墙面与地板 DIY", "设计可保存、可复用的材质"],
                    ].map(([Icon, title, sub]) => (
                      <li key={title}>
                        <Icon size={17} />
                        <div>
                          <strong>{title}</strong>
                          <span>{sub}</span>
                        </div>
                        <ChevronRight size={13} />
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="ai-guide-block ai-privacy">
                  <ShieldCheck size={20} />
                  <h3>密钥只留在本机</h3>
                  <p>
                    连接密钥加密保存，不会回显到页面，也不会写入任务记录或设计文件。
                  </p>
                  <p>
                    使用 DeepSeek 时，设计描述和必要的参考图会发送至
                    DeepSeek；本机 Codex 沿用其已配置的服务。
                  </p>
                </div>
                <div className="ai-guide-block ai-quick-tip">
                  <h3>想临时换个模型？</h3>
                  <p>
                    在生成表单的「AI
                    来源」中切换即可。默认来源不会因此改变，失败也不会自动调用另一家服务。
                  </p>
                </div>
                {configured && (
                  <details
                    className="ai-remove"
                    open={remove}
                    onToggle={(e) => setRemove(e.currentTarget.open)}
                  >
                    <summary>移除 DeepSeek 连接</summary>
                    <p>将删除本机保存的密钥，并恢复以本机 Codex 为默认来源。</p>
                    <button
                      disabled={busy}
                      onClick={() =>
                        send(
                          "/ai/settings",
                          {
                            provider: "codex",
                            revision: settings.revision,
                            remove_key: true,
                          },
                          true,
                        )
                      }
                    >
                      确认移除并切回 Codex
                    </button>
                  </details>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
