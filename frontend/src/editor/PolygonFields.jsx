import { Plus, Trash2 } from "lucide-react";
import NumberField from "./NumberField.jsx";
import { clone, round } from "./geometry.js";

export default function PolygonFields({ points, onChange, max = 24 }) {
  return (
    <details className="edit-vertices">
      <summary>精确调整角点（{points.length}）</summary>
      {points.map((point, index) => (
        <div className="vertex-row" key={index}>
          <span>{index + 1}</span>
          {["x", "y"].map((axis) => (
            <NumberField
              key={axis}
              label={`角点 ${index + 1} ${axis.toUpperCase()}`}
              value={point[axis]}
              onCommit={(value) => {
                const next = clone(points);
                next[index][axis] = value;
                onChange(next);
              }}
            />
          ))}
          <button
            aria-label={`在角点 ${index + 1} 后增加角点`}
            title="在这条边中间增加角点"
            disabled={points.length >= max}
            onClick={() => {
              const next = clone(points),
                b = points[(index + 1) % points.length];
              next.splice(index + 1, 0, {
                x: round((point.x + b.x) / 2),
                y: round((point.y + b.y) / 2),
              });
              onChange(next);
            }}
          >
            <Plus size={12} />
          </button>
          <button
            aria-label={`删除角点 ${index + 1}`}
            title="删除角点"
            disabled={points.length <= 3}
            onClick={() => onChange(points.filter((_, i) => i !== index))}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <p className="field-note">每条边均可增加角点；至少保留三个角点。</p>
    </details>
  );
}
