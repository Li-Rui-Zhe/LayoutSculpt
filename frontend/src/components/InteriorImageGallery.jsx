import { useState } from "react";
import { Clock3, Download, FolderOpen, ImagePlus } from "lucide-react";
import Modal from "./Modal.jsx";

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function InteriorImageGallery({
  items,
  folder,
  loading,
  error,
  onRetry,
  onCompose,
}) {
  const [selectedId, setSelectedId] = useState("");
  const selected = items.find((item) => item.id === selectedId);

  return (
    <div className="interior-gallery">
      <header className="interior-gallery-heading">
        <div>
          <h2>我的效果图</h2>
          <p>最新记录排在前面。打开图片可以对照当时的三维底图。</p>
        </div>
        {folder && (
          <span className="interior-gallery-folder">
            <FolderOpen size={15} aria-hidden="true" />
            <span>本机保存位置</span>
            <code title={folder}>{folder}</code>
          </span>
        )}
      </header>
      {loading && <p role="status">正在读取本机效果图…</p>}
      {error && (
        <div className="interior-gallery-error">
          <p role="alert">{error}</p>
          <button type="button" className="secondary-button" onClick={onRetry}>
            重新读取
          </button>
        </div>
      )}
      {!items.length && !loading && !error && (
        <div className="interior-gallery-empty">
          <ImagePlus size={26} aria-hidden="true" />
          <h3>还没有生成记录</h3>
          <p>提交后，进度和成图都会出现在这里。</p>
          <button type="button" className="primary-button" onClick={onCompose}>
            去创作
          </button>
        </div>
      )}
      <ul className="interior-gallery-grid" aria-label="效果图生成记录">
        {items.map((item) => (
          <li key={item.id} className="interior-gallery-card">
            <button
              type="button"
              className="interior-gallery-preview"
              onClick={() => setSelectedId(item.id)}
              aria-label={`查看 ${dateFormat.format(new Date(item.created_at))} 的效果图`}
            >
              <img
                src={item.thumbnail_url || item.view_url}
                loading="lazy"
                alt={item.image_url ? "效果图缩略图" : "三维底图"}
              />
              <span data-status={item.status}>
                {item.status === "ready"
                  ? "已保存"
                  : item.status === "generating"
                    ? "生成中"
                    : "未完成"}
              </span>
            </button>
            <div className="interior-gallery-card-body">
              <time dateTime={item.created_at}>
                <Clock3 size={13} aria-hidden="true" />
                {dateFormat.format(new Date(item.created_at))}
              </time>
              <p>{item.prompt}</p>
              {item.image_url && (
                <a
                  className="secondary-button"
                  href={item.image_url}
                  download={`室内效果图-${item.id.slice(0, 8)}.png`}
                >
                  <Download size={14} /> 下载 PNG
                </a>
              )}
              {item.error && <small>{item.error}</small>}
            </div>
          </li>
        ))}
      </ul>
      {selected && (
        <Modal
          title="效果图记录"
          className="capture-dialog interior-gallery-dialog"
          onClose={() => setSelectedId("")}
        >
          <div
            className={`interior-image-comparison${selected.image_url ? " has-result" : ""}`}
          >
            <figure>
              <figcaption>三维底图</figcaption>
              <img src={selected.view_url} alt="生成时的三维底图" />
            </figure>
            {selected.image_url && (
              <figure>
                <figcaption>AI 效果图</figcaption>
                <img src={selected.image_url} alt="保存的 AI 效果图" />
              </figure>
            )}
          </div>
          <p className="interior-gallery-prompt">{selected.prompt}</p>
          {selected.error && <p role="status">{selected.error}</p>}
          {selected.status === "generating" && (
            <p role="status">正在生成，完成后会自动保存。</p>
          )}
          {selected.image_url && (
            <a
              className="primary-button"
              href={selected.image_url}
              download={`室内效果图-${selected.id.slice(0, 8)}.png`}
            >
              <Download size={15} /> 下载 PNG
            </a>
          )}
        </Modal>
      )}
    </div>
  );
}
