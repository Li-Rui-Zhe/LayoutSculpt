import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Download,
  ImagePlus,
  Search,
  RefreshCw,
} from "lucide-react";
import Modal from "./Modal.jsx";
import { filterInteriorImages } from "./interiorImageState.js";
import { interiorExteriors } from "../hooks/interiorDraft.js";

const dates = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function exteriorLabel(context) {
  const exterior = context?.exterior;
  if (!exterior || exterior === "auto") return "";
  return exterior === "custom"
    ? context.exteriorDescription
    : interiorExteriors[exterior];
}
export default function InteriorImageGallery({
  items,
  loading,
  error,
  onRetry,
  onCompose,
  onReuse,
  onArchive,
  onDownload,
  onCancel,
  action,
  sending,
}) {
  const [selectedId, setSelectedId] = useState("");
  const [filters, setFilters] = useState({
    query: "",
    project: "",
    archived: false,
  });
  const [limit, setLimit] = useState(24);
  const selected = items.find((item) => item.id === selectedId);
  const filtered = filterInteriorImages(items, filters);
  const projects = [
    ...new Map(
      items.map((item) => [
        item.context?.projectId || "legacy",
        item.context?.title || "历史记录（未关联项目）",
      ]),
    ).entries(),
  ];
  const change = (patch) => {
    setFilters((v) => ({ ...v, ...patch }));
    setLimit(24);
  };
  function actions(item) {
    return (
      <div className="interior-gallery-actions">
        {item.image_url && (
          <button disabled={!!action} onClick={() => onDownload(item)}>
            <Download size={14} />
            {action === `download-${item.id}` ? "准备下载…" : "下载"}
          </button>
        )}
        <button disabled={sending || !!action} onClick={() => onReuse(item)}>
          <RefreshCw size={14} />
          {item.status === "failed" ? "重试此取景" : "复用取景"}
        </button>
        {item.status === "generating" ? (
          <button disabled={!!action} onClick={() => onCancel(item)}>
            取消生成
          </button>
        ) : (
          <button disabled={!!action} onClick={() => onArchive(item)}>
            {item.archived ? (
              <ArchiveRestore size={14} />
            ) : (
              <Archive size={14} />
            )}
            {item.archived ? "恢复" : "归档"}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="interior-gallery">
      <header className="interior-gallery-heading">
        <div>
          <span className="interior-image-eyebrow">留住每一种可能</span>
          <h2>我的效果图</h2>
          <p>按项目找到图片，也可以沿用一个镜头，试试新的氛围。</p>
        </div>
        <button className="secondary-button" onClick={onCompose}>
          <ImagePlus size={15} />
          继续创作
        </button>
      </header>
      <div className="interior-gallery-filters">
        <label className="interior-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="搜索效果图"
            placeholder="搜索项目、房间或描述"
            value={filters.query}
            onChange={(e) => change({ query: e.target.value })}
          />
        </label>
        <select
          aria-label="按项目筛选效果图"
          value={filters.project}
          onChange={(e) => change({ project: e.target.value })}
        >
          <option value="">全部项目</option>
          {projects.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
              {id !== "legacy" && id !== "sample" ? ` · ${id.slice(0, 6)}` : ""}
            </option>
          ))}
        </select>
        <button
          aria-pressed={filters.archived}
          onClick={() => change({ archived: !filters.archived })}
        >
          <Archive size={14} />
          {filters.archived ? "返回未归档" : "已归档"}
        </button>
      </div>
      {loading && <p role="status">正在读取本机效果图…</p>}
      {error && (
        <button className="text-button" onClick={onRetry}>
          重新读取记录
        </button>
      )}
      {!filtered.length && !loading && !error && (
        <div className="interior-gallery-empty">
          <ImagesPlaceholder />
          <h3>
            {items.length ? "没有符合条件的图片" : "第一张效果图，等你来创作"}
          </h3>
          <p>
            {items.length
              ? "换一个关键词或项目试试。归档图片随时可以恢复。"
              : "完成的图片会保存在这里，底图和描述也会一起留下。"}
          </p>
          {!items.length && (
            <button className="primary-button" onClick={onCompose}>
              去创作
            </button>
          )}
        </div>
      )}
      <ul className="interior-gallery-grid" aria-label="效果图生成记录">
        {filtered.slice(0, limit).map((item) => (
          <li key={item.id} className="interior-gallery-card">
            <button
              className="interior-gallery-preview"
              onClick={() => setSelectedId(item.id)}
              aria-label={`查看 ${dates.format(new Date(item.created_at))} 的效果图`}
            >
              <img
                src={item.thumbnail_url || item.view_url}
                loading="lazy"
                alt={item.image_url ? "效果图缩略图" : "三维底图"}
              />
              <span data-status={item.status}>
                {item.status === "ready"
                  ? "已完成"
                  : item.status === "generating"
                    ? "生成中"
                    : "未完成"}
              </span>
            </button>
            <div className="interior-gallery-card-body">
              <strong>
                {item.context?.title || "历史取景"}
                {item.context?.roomName ? ` · ${item.context.roomName}` : ""}
              </strong>
              <time dateTime={item.created_at}>
                {dates.format(new Date(item.created_at))}
              </time>
              {(item.prompt || exteriorLabel(item.context)) && (
                <p>{item.prompt || exteriorLabel(item.context)}</p>
              )}
              {item.error && <small>{item.error}</small>}
              {actions(item)}
            </div>
          </li>
        ))}
      </ul>
      {filtered.length > limit && (
        <button
          className="secondary-button"
          onClick={() => setLimit((v) => v + 24)}
        >
          加载更多（{limit} / {filtered.length}）
        </button>
      )}
      {selected && (
        <Modal
          title="效果图与三维底图"
          className="capture-dialog interior-gallery-dialog"
          onClose={() => setSelectedId("")}
        >
          <div
            className={`interior-image-comparison${selected.image_url ? " has-result" : ""}`}
          >
            <figure>
              <img src={selected.view_url} alt="生成时的三维底图" />
              <figcaption>三维底图</figcaption>
            </figure>
            {selected.image_url && (
              <figure>
                <img src={selected.image_url} alt="保存的 AI 效果图" />
                <figcaption>空间效果</figcaption>
              </figure>
            )}
          </div>
          {exteriorLabel(selected.context) && (
            <p className="interior-gallery-prompt">
              窗外景色 · {exteriorLabel(selected.context)}
            </p>
          )}
          {selected.prompt && (
            <p className="interior-gallery-prompt">{selected.prompt}</p>
          )}
          {selected.error && <p role="status">{selected.error}</p>}
          {actions(selected)}
          <p className="interior-stage-note">
            效果图用于看氛围，尺寸与布局以三维方案为准。归档不会删除图片。
          </p>
        </Modal>
      )}
    </div>
  );
}
function ImagesPlaceholder() {
  return (
    <div className="interior-gallery-empty-icon">
      <ImagePlus size={30} />
    </div>
  );
}
