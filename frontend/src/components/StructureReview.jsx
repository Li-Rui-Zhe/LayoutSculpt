import { InlineProgress } from "./LoadingProgress.jsx";
import { useEffect, useState } from "react";
import { Check, PencilRuler } from "lucide-react";
import { api } from "../api.js";
import { toDraft, openingPoints } from "../editor/geometry.js";
import {
  balconyNames,
  boundaryNames,
  isGlassBoundary,
} from "../editor/balcony.js";

export function StructurePlan({ layout }) {
  const points = layout.outline;
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  const width = Math.max(...points.map((p) => p.x)) - x,
    height = Math.max(...points.map((p) => p.y)) - y;
  const walls = new Map(layout.walls.map((wall) => [wall.id, wall]));
  return (
    <svg
      viewBox={`${x - 0.3} ${y - 0.3} ${width + 0.6} ${height + 0.6}`}
      role="img"
      aria-label="识别出的墙体、房间和门窗结构图"
    >
      <polygon
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="#f4f2eb"
      />
      {layout.rooms.map((room) => {
        const center = room.polygon.reduce(
          (s, p) => ({
            x: s.x + p.x / room.polygon.length,
            y: s.y + p.y / room.polygon.length,
          }),
          { x: 0, y: 0 },
        );
        return (
          <g key={room.id}>
            <polygon
              points={room.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={room.kind === "balcony" ? "#d2e5dd" : "#e4dece"}
              stroke="#fff"
              strokeWidth=".025"
            />
            <text
              x={center.x}
              y={center.y}
              fontSize=".19"
              fill="#283c39"
              textAnchor="middle"
            >
              {room.name}
            </text>
          </g>
        );
      })}
      {layout.walls.map((w) => (
        <line
          key={w.id}
          x1={w.start.x}
          y1={w.start.y}
          x2={w.end.x}
          y2={w.end.y}
          stroke={
            isGlassBoundary(w)
              ? "#2382a0"
              : w.boundary_type === "parapet"
                ? "#728b7b"
                : "#314642"
          }
          strokeWidth={w.thickness}
          strokeLinecap="square"
        >
          <title>
            {w.id} · {boundaryNames[w.boundary_type || "wall"]} ·{" "}
            {w.height.toFixed(2)} m
          </title>
        </line>
      ))}
      {layout.openings.map((opening, i) => {
        const wall = walls.get(opening.wall_id);
        if (!wall) return null;
        const [a, b] = openingPoints(opening, wall);
        return (
          <g key={i}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#f4f2eb"
              strokeWidth={wall.thickness + 0.03}
            />
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={opening.kind === "window" ? "#2382a0" : "#be863b"}
              strokeWidth=".045"
            />
          </g>
        );
      })}
    </svg>
  );
}

export default function StructureReview({ job, projects, onEdit }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    api(`/jobs/${job.id}/artifacts/structure.json`)
      .then((value) => {
        if (alive) {
          setData(value);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [job.id, revision]);
  const confirm = async () => {
    if (!data || busy) return;
    setBusy(true);
    setError("");
    try {
      await projects.confirmStructure(job.id, {
        layout: toDraft(data).layout,
        reviewed: true,
        revision: job.result.revision,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await projects.cancel(job.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="structure-review" aria-labelledby="structure-title">
      <div className="review-heading">
        <span className="eyebrow">02 · 核对户型</span>
        <h2 id="structure-title">先确认结构，再生成三维</h2>
        <p>逐项对照房间、墙体、入口和门窗。蓝色是窗，金色是门或通道。</p>
        {job.result?.ai_review?.status === "completed" &&
          job.result.ai_review.summary && (
            <p className="review-ai-summary">
              AI 复核：{job.result.ai_review.summary}
            </p>
          )}
      </div>
      {["timed_out", "incomplete"].includes(job.result?.ai_review?.status) && (
        <div className="review-status-warning" role="status">
          <strong>AI 复核未完成，请人工核对</strong>
          <p>{job.result.ai_review.message}</p>
        </div>
      )}
      {data ? (
        <>
          <div className="structure-pair">
            <figure>
              <figcaption>原始户型图</figcaption>
              <a
                href={job.source_url}
                target="_blank"
                rel="noreferrer"
                aria-label="放大原始户型图"
              >
                <img src={job.source_url} alt="用于核对的原始户型图" />
              </a>
            </figure>
            <figure>
              <figcaption>
                识别结构 · {data.rooms.length} 个空间 / {data.walls.length} 道墙
              </figcaption>
              <StructurePlan layout={data} />
            </figure>
          </div>
          <div className="review-notes">
            {data.rooms.some((room) => room.kind === "balcony") && (
              <details open>
                <summary>阳台围护与高度核对</summary>
                <p>
                  {data.rooms
                    .filter((room) => room.kind === "balcony")
                    .map(
                      (room) =>
                        `${room.name}：${balconyNames[room.balcony_type || "unknown"]}`,
                    )
                    .join("；")}
                  。请对照原图核对外侧栏板、封窗及两端实墙；蓝色墙线表示玻璃围护，可在结构图上查看各段类型和高度，有偏差时进入“调整识别结构”。
                </p>
                <ul>
                  {data.walls
                    .filter(
                      (wall) =>
                        wall.boundary_type && wall.boundary_type !== "wall",
                    )
                    .map((wall) => (
                      <li key={wall.id}>
                        {wall.id} · {boundaryNames[wall.boundary_type]} · 总高{" "}
                        {wall.height.toFixed(2)} m
                        {isGlassBoundary(wall) &&
                          ` · 基座 ${(wall.sill_height || 0).toFixed(2)} m`}
                      </li>
                    ))}
                </ul>
              </details>
            )}
            <p>{data.scale_note}</p>
            {job.result.warnings?.length > 0 && (
              <details open>
                <summary>
                  需要留意的 {job.result.warnings.length} 项说明
                </summary>
                <ul>
                  {job.result.warnings.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <p className="field-note">
            核对墙体、房间和门窗后，点击“已核对，继续生成”；有偏差可先调整结构。
          </p>
          <div className="review-actions">
            <button
              className="text-button review-cancel"
              disabled={busy}
              onClick={cancel}
            >
              停止此任务
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={onEdit}
            >
              <PencilRuler size={16} />
              调整识别结构
            </button>
            <button
              className="primary-button"
              disabled={!data || busy}
              onClick={confirm}
            >
              <InlineProgress
                active={busy}
                failed={!!error}
                cancelled={job.status === "cancelled"}
                fallback={<Check size={16} />}
              />
              已核对，继续生成
            </button>
          </div>
        </>
      ) : (
        !error && <p role="status">正在读取识别结构…</p>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => setRevision((v) => v + 1)}
          >
            重新读取
          </button>
        </div>
      )}
    </section>
  );
}
