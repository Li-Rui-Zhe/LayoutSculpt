import { useEffect, useState, useRef } from "react";
import { api } from "../api.js";
import Modal from "./Modal.jsx";
import Viewport from "./Viewport.jsx";
import { ViewportProvider } from "../viewer/ViewportRuntime.jsx";
import { initialStudio } from "../hooks/useStudio.js";
import { toDraft } from "../editor/geometry.js";
import { versionChanges } from "./versionDiff.js";

const compareState = structuredClone(initialStudio);
const compareSettings = {
  shadows: true,
  rotate: false,
  grid: false,
  cutaway: true,
};
function ComparisonScene({ job, other }) {
  const viewer = useRef(null),
    camera = useRef(null);
  const [side, setSide] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const change = (next) => {
    camera.current = viewer.current?.cameraState();
    setLoading(true);
    setError("");
    setSide(next);
  };
  return (
    <div className="version-scene">
      <div className="compare-switch">
        <button disabled={loading || side === 0} onClick={() => change(0)}>
          当前版本
        </button>
        <button disabled={loading || side === 1} onClick={() => change(1)}>
          对比版本
        </button>
        <button
          disabled={loading}
          onClick={() => {
            camera.current = null;
            viewer.current?.reset(false);
          }}
        >
          适配全屋
        </button>
      </div>
      <Viewport
        ref={viewer}
        url={(side === 0 ? job : other).result.model_url}
        state={compareState}
        settings={compareSettings}
        onLoading={(busy) => {
          setLoading(busy);
          if (!busy && camera.current)
            viewer.current?.restoreCamera(camera.current);
        }}
        onError={(message) => {
          setError(message);
          setLoading(false);
        }}
      />
      {loading && (
        <p className="compare-loading">
          正在载入{side === 0 ? "当前" : "对比"}版本…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <small>保持同一镜头切换，拖动画面可换角度；两版使用相同日光环境。</small>
    </div>
  );
}

const categories = [
  ["rooms", "空间"],
  ["walls", "墙体"],
  ["openings", "门窗与通道"],
  ["furniture", "家具"],
  ["lights", "灯具"],
];
function Plan({ data }) {
  const points = data.outline,
    xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  return (
    <svg
      viewBox={`${Math.min(...xs) - 0.5} ${Math.min(...ys) - 0.5} ${Math.max(...xs) - Math.min(...xs) + 1} ${Math.max(...ys) - Math.min(...ys) + 1}`}
      aria-label="版本平面图"
    >
      {data.rooms.map((r) => (
        <polygon
          key={r.id}
          points={r.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="#e3dfcf"
          stroke="white"
          strokeWidth=".04"
        />
      ))}
      {data.walls.map((w) => (
        <line
          key={w.id}
          x1={w.start.x}
          y1={w.start.y}
          x2={w.end.x}
          y2={w.end.y}
          stroke="#3a5848"
          strokeWidth={w.thickness}
        />
      ))}
      {(data.furniture || []).map((f, i) => (
        <rect
          key={i}
          x={f.x - f.width / 2}
          y={f.y - f.depth / 2}
          width={f.width}
          height={f.depth}
          transform={`rotate(${f.rotation} ${f.x} ${f.y})`}
          fill="#bcad88"
          stroke="#8b815f"
          strokeWidth=".02"
        />
      ))}
    </svg>
  );
}
export default function VersionCompare({ job, versions, onClose, onRestore }) {
  const others = versions
    .filter((v) => v.status === "succeeded" && v.id !== job.id)
    .sort((a, b) => (b.version || 0) - (a.version || 0));
  const [other, setOther] = useState(others[0]?.id || ""),
    [data, setData] = useState(null),
    [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false),
    [show3d, setShow3d] = useState(false);
  const restoreLock = useRef(false);
  const otherJob = others.find((v) => v.id === other);
  const changes = data ? versionChanges(data[1], data[0]) : [];
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    if (!other) return;
    Promise.all(
      [job.id, other].map((id) => api(`/jobs/${id}/artifacts/layout.json`)),
    )
      .then((v) => {
        if (alive) setData(v);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [job.id, other]);
  return (
    <Modal
      title="设计版本比较"
      className="workspace-help version-compare"
      onClose={onClose}
    >
      <h2>版本比较</h2>
      <p>
        当前：{job.name} · V{job.version}
      </p>
      <label>
        对比版本{" "}
        <select value={other} onChange={(e) => setOther(e.target.value)}>
          {others.map((v) => (
            <option key={v.id} value={v.id}>
              V{v.version} · {v.name}
            </option>
          ))}
        </select>
      </label>
      {!others.length && <p>保存第二个设计版本后即可比较。</p>}
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          {job.result?.model_url && otherJob?.result?.model_url && (
            <button
              className="secondary-button"
              onClick={() => setShow3d((v) => !v)}
            >
              {show3d ? "收起三维对比" : "同镜头三维对比"}
            </button>
          )}
          {show3d && otherJob && (
            <ViewportProvider>
              <ComparisonScene key={other} job={job} other={otherJob} />
            </ViewportProvider>
          )}
          <div className="compare-plans">
            {data.map((d, i) => (
              <div key={i}>
                <h3>{i === 0 ? "当前版本" : "对比版本"}</h3>
                <Plan data={d} />
              </div>
            ))}
          </div>
          <details>
            <summary>查看各类对象数量</summary>
            <table>
              <thead>
                <tr>
                  <th>对象</th>
                  <th>当前</th>
                  <th>对比</th>
                  <th>变化</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(([key, label]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>{data[0][key]?.length || 0}</td>
                    <td>{data[1][key]?.length || 0}</td>
                    <td>
                      {changes.some((change) => change.category === label)
                        ? "有修改"
                        : "一致"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <details open className="version-change-list">
            <summary>
              从对比版本到当前版本 · {changes.length} 处对象变化
            </summary>
            <ul>
              {changes.map((change, i) => (
                <li key={i}>
                  <strong>
                    {change.action} · {change.name}
                  </strong>{" "}
                  <span>{change.fields.join("、") || change.category}</span>
                </li>
              ))}
            </ul>
          </details>
          {onRestore && (
            <button
              className="primary-button"
              disabled={restoring}
              onClick={async () => {
                if (restoreLock.current) return;
                restoreLock.current = true;
                setRestoring(true);
                setError("");
                try {
                  await onRestore({
                    ...toDraft(data[1]),
                    name: `${job.name.slice(0, 90)} · 恢复 V${otherJob?.version || "历史"}`,
                  });
                  onClose();
                } catch (e) {
                  setError(e.message);
                } finally {
                  restoreLock.current = false;
                  setRestoring(false);
                }
              }}
            >
              {restoring ? "正在创建恢复版本…" : "恢复对比版本为新版本"}
            </button>
          )}
          <small>恢复会新建一个版本，当前版本和草稿继续保留。</small>
        </>
      )}
    </Modal>
  );
}
