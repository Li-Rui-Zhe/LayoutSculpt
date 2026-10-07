import { RotateCcw } from "lucide-react";
import { effortLabel } from "../hooks/useModels.js";
import { selectableModel } from "../hooks/modelSelection.js";

export default function ModelFields({ models, idPrefix = "project" }) {
  const id = idPrefix;
  return (
    <>
      <div className="field">
        <div className="field-heading">
          <label htmlFor={`${id}-model`}>生成模型</label>
          <button
            type="button"
            className="text-button"
            onClick={() => models.refresh(true)}
            disabled={models.loading}
          >
            <RotateCcw size={12} className={models.loading ? "spin" : ""} />
            刷新模型
          </button>
        </div>
        <select
          id={`${id}-model`}
          value={models.model}
          onChange={(e) => models.select(e.target.value)}
          disabled={models.loading || !models.catalog}
        >
          {!models.selected && (
            <option value={models.model}>
              {models.loading ? "正在读取模型…" : "请选择可用模型"}
            </option>
          )}
          {models.catalog?.items.map((item) => (
            <option
              key={item.id}
              value={item.id}
              disabled={!selectableModel(item)}
            >
              {item.name}
              {item.id === models.catalog.default_model ? " · 推荐默认" : ""}
              {item.available === false
                ? " · 当前不可选"
                : item.supports_image === false
                  ? " · 不支持图片"
                  : ""}
              {item.source === "local_config" && item.available !== false
                ? " · 本地配置"
                : ""}
            </option>
          ))}
        </select>
        {models.error && <p className="field-error">{models.error}</p>}
        {models.catalog?.notice && (
          <p className="field-note" role="status">
            {models.catalog.notice}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor={`${id}-effort`}>推理强度</label>
        <select
          id={`${id}-effort`}
          value={models.effort}
          disabled={!models.ready || !models.efforts.length}
          onChange={(e) => models.selectEffort(e.target.value)}
        >
          {!models.effort && <option value="">使用本地默认</option>}
          {models.efforts.map((value) => (
            <option key={value} value={value}>
              {effortLabel(value)} · {value}
              {value === models.selected?.default_effort ? "（模型默认）" : ""}
            </option>
          ))}
        </select>
        <small className="field-note">
          {models.efforts.length
            ? "应用于识别、复核和规划；强度越高，通常耗时越长。"
            : "当前服务未返回该模型的推理档位，沿用本地设置。"}
        </small>
      </div>
    </>
  );
}
