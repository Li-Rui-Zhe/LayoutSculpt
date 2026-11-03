import { useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import { guardedFetch } from "../connectionGuard.js";

export default function ShareExport({ job, viewer, rooms, roomId, onClose }) {
  const [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [url, setUrl] = useState(null);
  const cancelled = useRef(false),
    lock = useRef(false),
    request = useRef(null),
    ownedUrl = useRef(null);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      request.current?.abort();
      if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    };
  }, []);
  const run = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const engine = viewer.current?.captureSession(),
      original = engine?.cameraState();
    let changedView = false;
    const controller = new AbortController();
    request.current = controller;
    try {
      if (!engine || !original) throw Error("请等待三维画面加载完成后重试。");
      const response = await guardedFetch(`/api/jobs/${job.id}/report`, {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      if (!response.ok) throw Error("设计报告暂时无法读取，请重试。");
      const report = new DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      if (cancelled.current) return;
      const gallery = report.createElement("section");
      gallery.className = "share-gallery";
      const append = (name, image) => {
        if (!image) throw Error("效果图未准备好，请重试。");
        const figure = report.createElement("figure"),
          caption = report.createElement("figcaption"),
          img = report.createElement("img");
        caption.textContent = name;
        img.src = image;
        img.alt = name;
        figure.append(img, caption);
        gallery.append(figure);
      };
      setStatus("正在整理全屋效果…");
      changedView = true;
      engine.isolateRoom(null);
      engine.reset(false);
      append("全屋方案", engine.snapshot());
      for (let i = 0; i < rooms.length; i++) {
        if (cancelled.current) return;
        setStatus(`正在整理空间 ${i + 1}/${rooms.length} · ${rooms[i].name}`);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (cancelled.current) return;
        if (engine.focusRoom(rooms[i].id, false))
          append(rooms[i].name, engine.snapshot());
      }
      const note = report.createElement("p");
      note.textContent =
        "造个家 · LayoutSculpt｜本方案册可离线打开。效果图与清单来自当前已生成版本；尺寸仅作方案参考，请以现场测量为准。";
      const style = report.createElement("style");
      style.textContent =
        ".share-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}.share-gallery figure{margin:0;break-inside:avoid}.share-gallery figure:first-child{grid-column:1/-1}.share-gallery img{width:100%;border-radius:16px}.share-gallery figcaption{padding:8px 0;font-weight:600}";
      report.head.append(style);
      report.body.querySelector("h1")?.after(note, gallery);
      const blob = new Blob(
        ["<!doctype html>" + report.documentElement.outerHTML],
        { type: "text/html;charset=utf-8" },
      );
      if (cancelled.current) return;
      if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
      ownedUrl.current = URL.createObjectURL(blob);
      setUrl(ownedUrl.current);
      setStatus(`方案册已准备好 · ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
    } catch (e) {
      if (!cancelled.current) setError(e.message);
    } finally {
      if (changedView && original && engine?.isCurrent()) {
        engine.isolateRoom(roomId || null);
        engine.restoreCamera(original);
      }
      lock.current = false;
      request.current = null;
      if (!cancelled.current) setBusy(false);
    }
  };
  return (
    <Modal title="导出家庭方案册" className="workspace-help" onClose={onClose}>
      <h2>把设计带给家人看</h2>
      <p>
        包含全屋效果、各空间视图、平面尺寸和家具清单。保存为一个 HTML
        文件，无需安装工作台，双击即可打开，也可打印为 PDF。
      </p>
      <p>
        使用当前已生成版本。未保存的设计修改请先生成新版本；导出时会临时切换镜头，完成后恢复。
      </p>
      <button className="primary-button" disabled={busy} onClick={run}>
        {busy ? "正在整理方案…" : url ? "重新整理" : "生成离线方案册"}
      </button>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {url && (
        <a
          className="secondary-button"
          href={url}
          download={`${job.name.replace(/[\\/:*?"<>|]/g, "_")}-家庭方案册.html`}
        >
          下载家庭方案册
        </a>
      )}
    </Modal>
  );
}
