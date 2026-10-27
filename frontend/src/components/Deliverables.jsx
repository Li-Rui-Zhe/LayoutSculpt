import { useEffect, useRef, useState } from "react";
import {
  FolderDown,
  Check,
  Download,
  FileBox,
  Box,
  FileJson,
  ListChecks,
  Info,
  ArrowRight,
} from "lucide-react";
import { deliveryState, deliveryFingerprint } from "./deliveryState.js";
import { api } from "../api.js";
import OperationStatus from "./OperationStatus.jsx";

export default function Deliverables({ job, projects, onEdit, onCapture }) {
  const [draftState, setDraftState] = useState({ loading: true });
  const [checkRevision, setCheckRevision] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [pendingId, setPendingId] = useState(null);
  const lock = useRef(false),
    downloaded = useRef(null);
  const pendingDesign = useRef(null);
  async function readCurrent() {
    const [remote, layout] = await Promise.all([
      api(`/drafts/edit:${job.id}`),
      api(`/jobs/${job.id}/artifacts/layout.json`),
    ]);
    let local = null;
    try {
      local = JSON.parse(localStorage.getItem(`habitat-edit:${job.id}`));
    } catch {}
    return deliveryState(local, remote, layout);
  }
  useEffect(() => {
    let alive = true;
    if (job?.status !== "succeeded") return;
    setDraftState({ loading: true });
    readCurrent()
      .then((value) => {
        if (alive) setDraftState(value);
      })
      .catch(() => {
        if (alive) setDraftState({ unavailable: true });
      });
    return () => {
      alive = false;
    };
  }, [job?.id, job?.status, checkRevision]);
  const pending = projects.jobs.find((item) => item.id === pendingId);
  const waiting =
    pendingId &&
    !["succeeded", "failed", "cancelled"].includes(pending?.status);
  const download = (id) => {
    const link = document.createElement("a");
    link.href = `/api/jobs/${id}/bundle`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  useEffect(() => {
    if (pending?.status === "succeeded" && downloaded.current !== pending.id) {
      downloaded.current = pending.id;
      download(pending.id);
    }
  }, [pending?.id, pending?.status]);
  const exportCurrent = async () => {
    if (lock.current || waiting) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const current = await readCurrent();
      setDraftState(current);
      if (current.conflict)
        throw Error("草稿存在不同版本，请进入人工设计处理后再导出。");
      const fingerprint = deliveryFingerprint(current.document);
      if (
        pending?.status === "succeeded" &&
        pendingDesign.current === fingerprint
      ) {
        download(pending.id);
        return;
      }
      if (!current.changed) {
        download(job.id);
        return;
      }
      const item = await projects.edit(
        job.id,
        { ...current.document, name: "更新并导出" },
        { selectResult: false },
      );
      pendingDesign.current = fingerprint;
      setPendingId(item.id);
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  if (job?.status !== "succeeded" || !job?.result?.model_url)
    return (
      <div className="empty-state">
        <FolderDown size={38} />
        <h2>成果将在这里汇集</h2>
        <p>生成完成后，可以下载三维模型、工程文件和户型数据。</p>
      </div>
    );
  const result = job.result;
  return (
    <section className="deliverables-page">
      <div className="delivery-hero">
        <span className="delivery-mark">
          <Check size={24} />
        </span>
        <div>
          <span className="eyebrow">你的空间，已准备就绪</span>
          <h2>从设计到交付，一处完成。</h2>
          <p>
            {result.room_count} 个空间 · {result.area} ㎡ · 独立成果包
          </p>
        </div>
      </div>
      <p className="workspace-note" role="status">
        {draftState.loading
          ? "正在核对草稿与模型版本…"
          : draftState.unavailable
            ? "暂时无法核对最新草稿，下载前会再次检查。"
            : draftState.conflict
              ? "草稿存在版本冲突，请先进入人工设计处理。"
              : draftState.changed
                ? "人工设计草稿有新修改，导出时将生成新的模型版本。"
                : "草稿与当前模型一致，可以直接导出。"}
        <button className="text-button" onClick={onEdit}>
          进入人工设计
        </button>
        {draftState.unavailable && (
          <button
            className="text-button"
            onClick={() => setCheckRevision((n) => n + 1)}
          >
            重新核对
          </button>
        )}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
          <button className="text-button" onClick={() => setError("")}>
            关闭
          </button>
        </p>
      )}
      <OperationStatus
        active={busy || !!waiting}
        failed={!!error || pending?.status === "failed"}
        cancelled={pending?.status === "cancelled"}
        successLabel="成果已准备，已交给浏览器下载"
        progress={waiting ? pending?.progress : undefined}
        label={busy ? "正在核对最新设计" : pending?.stage || "正在更新导出模型"}
        detail="完成后下载成果包；离开此页也可在任务列表找到新版本。"
      />
      {pending?.status === "succeeded" && (
        <p className="workspace-note">
          新版本已完成。
          <a href={`/api/jobs/${pending.id}/bundle`} download>
            重新下载最新成果包
          </a>
        </p>
      )}
      {["failed", "cancelled"].includes(pending?.status) && (
        <p className="form-error">
          新版本未完成，原设计仍保留。
          <button
            className="text-button"
            onClick={() => projects.select(pending)}
          >
            查看任务
          </button>
        </p>
      )}
      <div className="delivery-actions">
        <a
          className="secondary-button"
          href={`/api/jobs/${job.id}/drawing/svg`}
          download
        >
          平面 SVG
        </a>
        <a
          className="secondary-button"
          href={`/api/jobs/${job.id}/drawing/dxf`}
          download
        >
          平面 DXF · 毫米
        </a>
        <button
          className="primary-button"
          onClick={exportCurrent}
          disabled={
            busy || !!waiting || draftState.loading || draftState.conflict
          }
        >
          {busy || waiting
            ? "正在准备成果…"
            : draftState.changed
              ? "更新并导出成果包"
              : "下载最新成果包"}
        </button>
        <a
          className="secondary-button"
          href={`/api/jobs/${job.id}/report`}
          target="_blank"
          rel="noreferrer"
        >
          查看报告 / 导出 PDF
        </a>
      </div>
      <p className="field-note">
        下面的单项文件、图纸和报告属于当前已生成版本；人工设计的最新修改请使用上方成果包导出；外观试配请先保存到设计版本。
      </p>
      <div className="deliverable-grid">
        {[
          [
            FileBox,
            "三维模型",
            "GLB",
            "可在三维软件中查看和继续使用",
            result.model_url,
          ],
          ...(result.blend_url
            ? [
                [
                  Box,
                  "Blender 工程",
                  "BLEND",
                  "包含模型、家具与打包贴图",
                  result.blend_url,
                ],
              ]
            : []),
          [
            FileJson,
            "户型结构数据",
            "JSON",
            "房间、墙体、门窗与家具布局",
            result.layout_url,
          ],
          [
            ListChecks,
            "生成清单",
            "JSON",
            "模型参数、识别说明与成果索引",
            `/api/jobs/${job.id}/artifacts/manifest.json`,
          ],
          ...(result.quality_url
            ? [
                [
                  ListChecks,
                  "设计检查",
                  "JSON",
                  "家具碰撞检查、照明配置与改进记录",
                  result.quality_url,
                ],
              ]
            : []),
          ...(result.consistency_url
            ? [
                [
                  ListChecks,
                  "结构一致性",
                  "JSON",
                  "墙体、门窗、地板和轮廓的校验记录",
                  result.consistency_url,
                ],
              ]
            : []),
        ].map(([Icon, title, type, desc, url]) => (
          <a className="deliverable-card" key={title} href={url} download>
            <Icon size={25} strokeWidth={1.4} />
            <span className="file-type">{type}</span>
            <h3>{title}</h3>
            <p>{desc}</p>
            <span className="download-label">
              下载文件 <Download size={14} />
            </span>
          </a>
        ))}
      </div>
      <div className="delivery-tip">
        <Info size={16} />
        <p>
          模型与工程保留生成时的材质。工作区的光照、配色调整可通过「导出效果图」保存为图片。
        </p>
        <button className="text-button" onClick={onCapture}>
          前往设计预览 <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}
