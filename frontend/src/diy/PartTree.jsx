import { shapes } from "./design.js";

export function partTree(parts, query = "") {
  const root = { name: "", children: new Map(), parts: [] };
  for (const part of parts) {
    if (!`${part.name} ${part.edit_group || ""}`.includes(query)) continue;
    let node = root;
    for (const name of (part.edit_group || "")
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (!node.children.has(name))
        node.children.set(name, { name, children: new Map(), parts: [] });
      node = node.children.get(name);
    }
    node.parts.push(part);
  }
  return root;
}

export default function PartTree({ parts, query, selected, onSelect }) {
  const render = (node) => (
    <>
      {[...node.children.values()].map((child) => (
        <details open key={child.name}>
          <summary>{child.name}</summary>
          <div className="diy-part-branch">{render(child)}</div>
        </details>
      ))}
      {node.parts.map((p) => (
        <button
          key={p.id}
          aria-pressed={selected === p.id}
          onClick={() => onSelect(p.id)}
        >
          <i style={{ background: p.color }} />
          <span>
            {p.name}
            {p.edit_locked ? " · 锁定" : ""}
            {p.edit_hidden ? " · 隐藏" : ""}
          </span>
          <small>{shapes[p.shape]?.split(" / ")[0]}</small>
        </button>
      ))}
    </>
  );
  const tree = partTree(parts, query);
  return (
    <div className="diy-parts-list" aria-label="部件树">
      {render(tree)}
      {!tree.parts.length && !tree.children.size && <p>没有匹配的部件。</p>}
    </div>
  );
}
