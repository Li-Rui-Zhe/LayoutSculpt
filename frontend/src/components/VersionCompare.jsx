import { useEffect, useState } from "react";
import { api } from "../api.js";
import Modal from "./Modal.jsx";

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
export default function VersionCompare({ job, versions, onClose }) {
  const others = versions.filter(
    (v) => v.status === "succeeded" && v.id !== job.id,
  );
  const [other, setOther] = useState(others[0]?.id || ""),
    [data, setData] = useState(null),
    [error, setError] = useState("");
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
          <div className="compare-plans">
            {data.map((d, i) => (
              <div key={i}>
                <h3>{i === 0 ? "当前版本" : "对比版本"}</h3>
                <Plan data={d} />
              </div>
            ))}
          </div>
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
                    {JSON.stringify(data[0][key] || []) ===
                    JSON.stringify(data[1][key] || [])
                      ? "一致"
                      : "有修改"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>“有修改”包含位置、尺寸、材质及对象属性变化；版本始终独立保存。</p>
        </>
      )}
    </Modal>
  );
}
