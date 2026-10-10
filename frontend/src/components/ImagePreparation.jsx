import { useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";

export default function ImagePreparation({ file, onApply, onClose }) {
  const canvas = useRef(null);
  const [crop, setCrop] = useState({ left: 0, top: 0, right: 0, bottom: 0 });
  const [angle, setAngle] = useState(0),
    [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    setReady(false);
    createImageBitmap(file)
      .then((image) => {
        if (!live) {
          image.close();
          return;
        }
        const radians = (angle * Math.PI) / 180;
        const width = (image.width * (100 - crop.left - crop.right)) / 100;
        const height = (image.height * (100 - crop.top - crop.bottom)) / 100;
        const boundsW =
          Math.abs(width * Math.cos(radians)) +
          Math.abs(height * Math.sin(radians));
        const boundsH =
          Math.abs(height * Math.cos(radians)) +
          Math.abs(width * Math.sin(radians));
        const scale = Math.min(1, 4096 / Math.max(boundsW, boundsH));
        const c = canvas.current;
        c.width = Math.max(1, Math.round(boundsW * scale));
        c.height = Math.max(1, Math.round(boundsH * scale));
        const ctx = c.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate(radians);
        ctx.scale(scale, scale);
        ctx.drawImage(
          image,
          (image.width * crop.left) / 100,
          (image.height * crop.top) / 100,
          width,
          height,
          -width / 2,
          -height / 2,
          width,
          height,
        );
        image.close();
        setReady(true);
        setError("");
      })
      .catch(() => {
        if (live) setError("图片无法解码，请重新选择。");
      });
    return () => {
      live = false;
    };
  }, [file, crop, angle]);
  return (
    <Modal title="整理户型图" onClose={onClose} className="workspace-help">
      <p>裁去边框与无关文字，旋转或微调倾斜角度。处理后替换本次待上传图片。</p>
      <canvas
        ref={canvas}
        style={{
          width: "100%",
          maxHeight: 300,
          objectFit: "contain",
          background: "white",
        }}
      />
      <div className="image-crop-controls">
        {Object.entries({
          left: "左侧",
          right: "右侧",
          top: "顶部",
          bottom: "底部",
        }).map(([key, label]) => (
          <label key={key}>
            {label}裁去 {crop[key]}%
            <input
              aria-label={`${label}裁剪`}
              type="range"
              min="0"
              max="45"
              value={crop[key]}
              onChange={(e) => setCrop({ ...crop, [key]: +e.target.value })}
            />
          </label>
        ))}
      </div>
      <label>
        旋转／纠偏角度{" "}
        <input
          aria-label="图片旋转角度"
          type="number"
          min="-180"
          max="180"
          value={angle}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setAngle(Math.min(180, Math.max(-180, n)));
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button
        className="primary-button"
        disabled={!ready}
        onClick={() =>
          canvas.current.toBlob((blob) => {
            if (blob)
              onApply(
                new File([blob], file.name.replace(/\.[^.]+$/, "-已整理.png"), {
                  type: "image/png",
                }),
              );
          }, "image/png")
        }
      >
        使用处理后的图片
      </button>
    </Modal>
  );
}
