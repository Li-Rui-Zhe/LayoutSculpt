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
import "./ai-connections.css";

const names = { codex: "Codex", deepseek: "DeepSeek API" };
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
  const applyCatalog = (value) => {
    setCatalog(value);
    setModel(value?.default_model || "");
  };
  const load = async () => {
    const current = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPhase("loading");
    setError("");
    try {
      const value = await api("/ai/settings", { signal: controller.signal });
      if (current !== sequence.current) return;
      setSettings(value);
      setProvider(value.revision > 0 ? value.default_provider : "deepseek");
      setKey("");
      setVisible(false);
      setCatalog(null);
      setModel("");
      setReloadNeeded(false);
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
  const choose = (value) => {
    if (busy || value === provider) return;
    setProvider(value);
    setCatalog(null);
    setModel("");
    setKey("");
    setVisible(false);
    setError("");
    setNotice("");
  };
  const send = async (testing = false, removeKey = false) => {
    const current = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPhase(testing ? "testing" : "saving");
    setError("");
    setNotice("");
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
      applyCatalog(value.catalog);
      if (testing) {
        setNotice(
          "连接检测通过，可在下方选择模型；点击连接按钮后保存。持续生成仍需账户有可用权限和额度。",
        );
      } else {
        setSettings(value);
        setKey("");
        setVisible(false);
        setReloadNeeded(false);
        if (removeKey) setProvider("deepseek");
        setNotice(
          removeKey
            ? "已移除 DeepSeek 密钥。默认来源已切回 Codex，使用前请确认连接可用。"
            : `已连接 ${names[value.default_provider]} 并设为默认，可以开始设计了。`,
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
          <div className="ai-current-source">
            <span>新任务默认来源</span>
            <strong>{names[settings.default_provider]}</strong>
            <span className="ai-current-note">
              已有任务保持原来的来源和模型
            </span>
          </div>
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
                        ? "填写密钥，就能开始"
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
                    <div className="ai-key-input">
                      <KeyRound size={16} />
                      <input
                        id="ai-api-key"
                        type={visible ? "text" : "password"}
                        autoComplete="new-password"
                        spellCheck={false}
                        placeholder={
                          configured
                            ? "已保存密钥，留空即可继续使用"
                            : "粘贴你的 API Key"
                        }
                        value={key}
                        disabled={busy}
                        maxLength={4096}
                        onChange={(e) => {
                          setKey(e.target.value);
                          setCatalog(null);
                          setModel("");
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
                        : "密钥加密保存在本机，保存后不回显。"}{" "}
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
                      if (replace) applyCatalog(value);
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
                {selected && (
                  <p className="ai-capability-note">
                    当前模型：{selected.name} ·{" "}
                    {selected.supports_image === true
                      ? "支持文字设计与识图（非图片生成）"
                      : selected.supports_image === false
                        ? "仅支持文字输入，上传户型图请切换图片模型"
                        : "识图能力尚未确认，上传图片前需检查"}
                  </p>
                )}
                <footer className="ai-save-row">
                  <span>自动检测连接、选择默认模型并保存</span>
                  <button
                    className="primary-button"
                    disabled={
                      busy ||
                      reloadNeeded ||
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
                      : `连接并使用 ${names[provider]}`}
                  </button>
                </footer>
                <details className="ai-advanced">
                  <summary>模型与更多设置</summary>
                  <p className="ai-field-help">
                    通常保持自动选择即可；生成任务时也能单独换模型。
                  </p>
                  <label htmlFor="ai-default-model">默认模型</label>
                  <select
                    id="ai-default-model"
                    value={model}
                    disabled={busy}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="">自动选择可用模型</option>
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
                      (provider === "deepseek" && !configured && !key.trim())
                    }
                    onClick={() => send(true)}
                  >
                    {phase === "testing" ? "正在读取…" : "读取可用模型"}
                  </button>
                  <p className="ai-field-help">
                    只读取模型目录，不产生生成任务。更换模型后点击上方连接按钮保存。
                  </p>
                  {provider === "deepseek" && configured && (
                    <details className="ai-remove">
                      <summary>移除已保存的密钥</summary>
                      <p>
                        删除本机密钥并切回 Codex，已有设计保留；Codex
                        需要另行连接。
                      </p>
                      <button disabled={busy} onClick={() => send(false, true)}>
                        确认移除密钥
                      </button>
                    </details>
                  )}
                </details>
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
