import { useEffect, useState } from "react";
import { api } from "../api.js";
import { openingPoints } from "../editor/geometry.js";
import {
  sourcePixel,
  validSourceAlignment,
} from "../editor/sourceAlignment.js";
import "./sourceOverlay.css";

export default function SourceOverlay({ job, layout }) {
  const [alignment, setAlignment] = useState(null);
  const [error, setError] = useState("");
  const [matchedImage, setMatchedImage] = useState(false);
  const [opacity, setOpacity] = useState(0.75);
  const [labels, setLabels] = useState(false);
  useEffect(() => {
    let live = true;
    setAlignment(null);
    setError("");
    setMatchedImage(false);
    if (!job.result?.source_alignment_url) return;
    api(`/jobs/${job.id}/artifacts/source-alignment.json`)
      .then((value) => {
        if (!validSourceAlignment(value))
          throw new Error("原图定位记录无效，请使用并排对照。");
        if (live) setAlignment(value);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [job.id, job.result?.source_alignment_url]);
  if (!job.result?.source_alignment_url)
    return (
      <p className="field-note">
        此任务没有原图定位记录，可使用上方并排对照；重新使用精细识别后可查看叠加图。
      </p>
    );
  if (!alignment)
    return (
      <p className="field-note" role="status">
        {error || "正在准备原图叠加对照…"}
      </p>
    );
  const px = (p) => sourcePixel(p, alignment);
  const walls = new Map(layout.walls.map((w) => [w.id, w]));
  const boundary = alignment.audit_outline || alignment.evidence_outline || [];
  return (
    <section className="source-overlay" aria-label="原图叠加对照">
      <header>
        <div>
          <h3>把识别线叠在原图上看</h3>
          <p>
            绿色是识别墙线，橙色虚线是
            {alignment.independent_review ? "独立" : "初步"}
            读图的边界。红框是需要核对的位置。
          </p>
        </div>
        <div className="source-overlay-controls">
          <label>
            线条透明度
            <input
              aria-label="识别线透明度"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={labels}
              onChange={(e) => setLabels(e.target.checked)}
            />
            显示房间名称
          </label>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      <div
        className="source-overlay-stage"
        style={{
          maxWidth: Math.min(
            900,
            (alignment.image_width / alignment.image_height) * 650,
          ),
        }}
      >
        <img
          src={job.source_url}
          alt="用于叠加对照的原始户型图"
          onLoad={(e) => {
            const matched =
              e.currentTarget.naturalWidth === alignment.image_width &&
              e.currentTarget.naturalHeight === alignment.image_height;
            setMatchedImage(matched);
            setError(
              matched
                ? ""
                : "定位记录与原图尺寸不一致，已隐藏叠加线，请使用并排对照。",
            );
          }}
          onError={() => {
            setMatchedImage(false);
            setError("原图暂时无法加载，识别结果仍保留。");
          }}
        />
        {matchedImage && (
          <svg
            viewBox={`0 0 ${alignment.image_width} ${alignment.image_height}`}
            role="img"
            aria-label="原图上的识别墙线和对照位置"
          >
            <g opacity={opacity}>
              <polygon
                points={layout.outline
                  .map((p) => {
                    const q = px(p);
                    return `${q.x},${q.y}`;
                  })
                  .join(" ")}
                fill="none"
                stroke="#008766"
                strokeWidth="1.3"
              />
              <polygon
                points={boundary.map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke="#c5761a"
                strokeWidth="2"
                strokeDasharray="7 5"
              />
              {layout.walls.map((w) => {
                const a = px(w.start),
                  b = px(w.end);
                return (
                  <line
                    key={w.id}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#008766"
                    strokeWidth="2.3"
                  >
                    <title>{w.id}</title>
                  </line>
                );
              })}
              {layout.openings.map((o, i) => {
                const wall = walls.get(o.wall_id);
                if (!wall) return null;
                const [a, b] = openingPoints(o, wall).map(px);
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={o.kind === "window" ? "#0076c0" : "#a343b7"}
                    strokeWidth="3.5"
                  />
                );
              })}
              {(alignment.findings || [])
                .filter((f) => Array.isArray(f.box) && f.box.length === 4)
                .map((f, i) => (
                  <rect
                    key={i}
                    x={f.box[0]}
                    y={f.box[1]}
                    width={f.box[2] - f.box[0]}
                    height={f.box[3] - f.box[1]}
                    fill="#dc4b3014"
                    stroke="#cb3e25"
                    strokeWidth="2"
                  >
                    <title>{f.message}</title>
                  </rect>
                ))}
              {labels &&
                layout.rooms.map((room) => {
                  const center = room.polygon.reduce(
                    (sum, p) => ({
                      x: sum.x + p.x / room.polygon.length,
                      y: sum.y + p.y / room.polygon.length,
                    }),
                    { x: 0, y: 0 },
                  );
                  const p = px(center);
                  return (
                    <text
                      key={room.id}
                      x={p.x}
                      y={p.y}
                      textAnchor="middle"
                      fill="#00634a"
                      stroke="white"
                      strokeWidth="2"
                      paintOrder="stroke"
                      fontSize="11"
                    >
                      {room.name}
                    </text>
                  );
                })}
            </g>
          </svg>
        )}
      </div>
      {!!alignment.findings?.length && (
        <ul>
          {alignment.findings.map((f, i) => (
            <li key={i}>{f.message}</li>
          ))}
        </ul>
      )}
      <p className="field-note">
        对照提示来自独立读图结果，不代表已证明还原准确；请以原图为准。
      </p>
    </section>
  );
}
