import { useState } from "react";
import materials from "../../../assets/materials/furniture.json" with { type: "json" };
import MaterialSample from "../components/MaterialSample.jsx";
import { materialTargets } from "./colors.js";

export default function ColorDesigner({ design, partId, disabled, onCommit }) {
  const [scope, setScope] = useState("selected"),
    [query, setQuery] = useState(""),
    [family, setFamily] = useState("全部");
  const part = design?.parts.find((p) => p.id === partId);
  const choices = materials.filter(
    (m) =>
      (family === "全部" || m.family === family) &&
      `${m.name} ${m.family}`.includes(query),
  );
  const apply = (m) =>
    onCommit((d) => {
      const ids = materialTargets(d, partId, scope);
      d.parts.forEach((p) => {
        if (ids.includes(p.id) && !p.edit_locked) {
          p.material_id = m?.id || null;
          if (m) {
            p.color = m.color;
            p.roughness = m.roughness ?? 0.7;
            p.metallic = m.metallic ?? 0;
          }
        }
      });
      return d;
    });
  return (
    <section className="diy-color-designer" aria-label="材质与饰面">
      <h3>材质与饰面</h3>
      <p>家具专用木材、布艺、皮革、金属、玻璃与台面石材。</p>
      <fieldset disabled={disabled || !design}>
        <label>
          应用范围
          <select
            aria-label="饰面应用范围"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="selected">选中部件</option>
            <option value="matching">同材质部件</option>
            <option value="all">整件家具</option>
          </select>
        </label>
        <label>
          家具材质分类
          <select
            aria-label="家具材质分类"
            value={family}
            onChange={(e) => setFamily(e.target.value)}
          >
            {["全部", ...new Set(materials.map((m) => m.family))].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <input
          aria-label="搜索家具饰面"
          placeholder="搜索木材、布料、石材"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="diy-finish-grid">
          {choices.map((m) => (
            <button
              key={m.id}
              title={m.name}
              aria-label={`应用${m.name}`}
              aria-pressed={part?.material_id === m.id}
              onClick={() => apply(m)}
            >
              <MaterialSample material={m} />
              <span>{m.name}</span>
            </button>
          ))}
        </div>
        <button onClick={() => apply(null)}>清除饰面纹理</button>
      </fieldset>
    </section>
  );
}
