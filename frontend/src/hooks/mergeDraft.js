const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const equal = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function mergeDraft(base, local, remote) {
  const conflicts = [];
  const merge = (a, b, c, path) => {
    if (equal(b, c) || equal(a, c)) return structuredClone(b);
    if (equal(a, b)) return structuredClone(c);
    if (
      [a, b, c].every((v) => v && typeof v === "object" && !Array.isArray(v))
    ) {
      const result = {};
      for (const key of new Set([
        ...Object.keys(a),
        ...Object.keys(b),
        ...Object.keys(c),
      ])) {
        const value = merge(a[key], b[key], c[key], `${path}/${key}`);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    if ([a, b, c].every(Array.isArray)) {
      const identify = (v) => v?.edit_id || v?.id;
      if (
        [...a, ...b, ...c].every(
          (v) => typeof v === "object" && v && identify(v),
        ) &&
        [a, b, c].every((v) => new Set(v.map(identify)).size === v.length)
      ) {
        const maps = [a, b, c].map(
            (rows) => new Map(rows.map((v) => [identify(v), v])),
          ),
          result = [];
        for (const id of new Set([
          ...b.map(identify),
          ...c.map(identify),
          ...a.map(identify),
        ])) {
          const value = merge(...maps.map((m) => m.get(id)), `${path}/${id}`);
          if (value !== undefined) result.push(value);
        }
        return result;
      }
    }
    conflicts.push(path || "/");
    return structuredClone(b);
  };
  return { document: merge(base, local, remote, ""), conflicts };
}
