import NumberField from "./NumberField.jsx";
import { materials, materialCategories } from "../catalog.js";
import { wallLength } from "./geometry.js";
import { nextWallFinish } from "./designTools.js";

export default function WallElevation({ wall, openings, onChange }) {
  const length = wallLength(wall),
    regions = wall.finish_regions || [];
  const available = nextWallFinish(wall);
  const change = (index, key, value) =>
    onChange(regions.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  return (
    <details className="edit-advanced">
      <summary>局部墙面 / 立面设计</summary>
      <p>按墙的起点定位局部木饰面、墙裙或背景墙；门窗洞口会自动避开。</p>
      <svg
        viewBox={`-.1 -.1 ${length + 0.2} ${wall.height + 0.2}`}
        style={{ width: "100%", maxHeight: 180, background: "#eeeee6" }}
        aria-label="墙体立面示意图"
      >
        {regions.map((r, i) => (
          <g key={i}>
            <rect
              x={r.offset}
              y={wall.height - r.bottom - r.height}
              width={r.width}
              height={r.height}
              fill={
                materials.find((m) => m.id === r.material)?.color || "#b5a68a"
              }
              stroke="#6f846e"
              strokeWidth=".015"
            />
            <text
              x={r.offset + 0.08}
              y={wall.height - r.bottom - 0.08}
              fontSize=".13"
            >
              {i + 1} · {r.side === "left" ? "A" : "B"}
            </text>
          </g>
        ))}
        {openings
          .filter((o) => o.wall_id === wall.id)
          .map((o, i) => (
            <rect
              key={i}
              x={o.offset}
              y={wall.height - o.bottom - o.height}
              width={o.width}
              height={o.height}
              fill="#fff"
              stroke="#5c8c96"
              strokeWidth=".025"
            />
          ))}
      </svg>
      {regions.map((r, i) => (
        <div className="wall-region" key={i}>
          <strong>饰面区域 {i + 1}</strong>
          <label>
            墙面侧
            <select
              value={r.side}
              onChange={(e) => change(i, "side", e.target.value)}
            >
              <option value="left">A 面</option>
              <option value="right">B 面</option>
            </select>
          </label>
          {[
            ["offset", "距起点", 0, length],
            ["width", "区域宽度", 0.05, length],
            ["bottom", "底部高度", 0, wall.height],
            ["height", "区域高度", 0.05, wall.height],
          ].map(([key, label, min, max]) => (
            <NumberField
              key={key}
              label={label}
              value={r[key]}
              min={min}
              max={max}
              onCommit={(v) => change(i, key, v)}
            />
          ))}
          <label>
            饰面材质
            <select
              value={r.material}
              onChange={(e) => change(i, "material", e.target.value)}
            >
              {materials
                .filter((m) => materialCategories.walls.includes(m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          {(r.offset + r.width > length + 0.001 ||
            r.bottom + r.height > wall.height + 0.001) && (
            <p role="alert">饰面超出墙体边界，请缩小尺寸。</p>
          )}
          <button
            onClick={() => onChange(regions.filter((_, index) => index !== i))}
          >
            删除此饰面区域
          </button>
        </div>
      ))}
      <button
        disabled={regions.length >= 8 || !available}
        onClick={() => onChange([...regions, available])}
      >
        增加局部饰面
      </button>
    </details>
  );
}
