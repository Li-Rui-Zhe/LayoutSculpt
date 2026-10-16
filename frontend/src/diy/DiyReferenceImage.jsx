import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { api } from "../api.js";

export default function DiyReferenceImage({
  value,
  onChange,
  disabled,
  onBusyChange,
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef(null),
    input = useRef(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
      onBusyChange(false);
    },
    [],
  );
  const upload = async (file) => {
    if (!file || disabled || busy) return;
    setError("");
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
      setError("请选择 PNG、JPG 或 WebP 图片");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("参考图片不能超过 10 MB");
      return;
    }
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    onBusyChange(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api("/diy/references", {
        method: "POST",
        body,
        signal: current.signal,
      });
      if (controller.current === current) onChange(result.id);
    } catch (e) {
      if (!current.signal.aborted) setError(e.message);
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(false);
        onBusyChange(false);
      }
    }
  };
  return (
    <section className="diy-reference" aria-label="家具参考图片">
      <div className="diy-reference-heading">
        <strong>
          参考图片 <small>可选</small>
        </strong>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={15} />
          {busy ? "正在上传…" : value ? "更换参考图片" : "上传参考图片"}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          aria-label="上传家具参考图片"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void upload(file);
          }}
        />
      </div>
      {value && (
        <div className="diy-reference-preview">
          <a
            href={`/api/diy/references/${value}.png`}
            target="_blank"
            rel="noreferrer"
            aria-label="查看参考原图"
          >
            <img
              src={`/api/diy/references/${value}.png`}
              alt="当前家具生成参考图"
            />
          </a>
          <div>
            <p>AI 将参考图片中的主体造型、比例和材质。</p>
            <button
              type="button"
              className="text-button"
              disabled={disabled || busy}
              onClick={() => {
                onChange(null);
                setError("");
              }}
            >
              <X size={14} />
              移除参考图片
            </button>
          </div>
        </div>
      )}
      <p className="field-note">
        可只上传图片，也可补充尺寸、颜色或想修改的部位。支持 PNG / JPG /
        WebP，最大 10 MB。生成的是可编辑模型，遮挡细节会合理补全。
      </p>
      {error && (
        <p role="alert" className="field-error">
          {error}；原有参考图保持不变。
        </p>
      )}
    </section>
  );
}
