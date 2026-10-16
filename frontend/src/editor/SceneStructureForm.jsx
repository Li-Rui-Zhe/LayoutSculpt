import { useState } from "react";
import { round } from "./geometry.js";

export default function SceneStructureForm({
  type,
  origin,
  onCreate,
  onCancel,
}) {
  const [points, setPoints] = useState(() =>
    (type === "walls"
      ? [
          { x: origin.x - 0.5, y: origin.y },
          { x: origin.x + 0.5, y: origin.y },
        ]
      : [
          { x: origin.x - 0.5, y: origin.y - 0.5 },
          { x: origin.x + 0.5, y: origin.y - 0.5 },
          { x: origin.x + 0.5, y: origin.y + 0.5 },
          { x: origin.x - 0.5, y: origin.y + 0.5 },
        ]
    ).map((p) => ({ x: String(round(p.x)), y: String(round(p.y)) })),
  );
  return (
    <form
      className="scene-structure-form"
      aria-label={type === "walls" ? "添加三维墙体" : "添加三维空间"}
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(points.map((p) => ({ x: Number(p.x), y: Number(p.y) })));
      }}
    >
      <p>
        输入{type === "walls" ? "墙体两端" : "空间边界"}
        坐标（米），添加后可直接在三维中调整。
      </p>
      {points.map((point, index) => (
        <div className="scene-point-row" key={index}>
          <span>
            {type === "walls" ? (index ? "终点" : "起点") : `角点 ${index + 1}`}
          </span>
          {["x", "y"].map((axis) => (
            <label key={axis}>
              {axis.toUpperCase()}
              <input
                aria-label={`${type === "walls" ? (index ? "终点" : "起点") : `角点 ${index + 1}`} ${axis.toUpperCase()} 坐标`}
                type="number"
                required
                min={-60}
                max={60}
                step="any"
                value={point[axis]}
                onChange={(e) =>
                  setPoints((values) =>
                    values.map((v, i) =>
                      i === index ? { ...v, [axis]: e.target.value } : v,
                    ),
                  )
                }
              />
            </label>
          ))}
        </div>
      ))}
      {type === "rooms" && (
        <div className="scene-form-actions">
          <button
            type="button"
            disabled={points.length >= 24}
            onClick={() => setPoints((v) => [...v, { ...v.at(-1) }])}
          >
            增加角点
          </button>
          <button
            type="button"
            disabled={points.length <= 3}
            onClick={() => setPoints((v) => v.slice(0, -1))}
          >
            移除末点
          </button>
        </div>
      )}
      <div className="scene-form-actions">
        <button type="submit">确认添加</button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
