const collections = (doc) => [
  ["furniture", doc.furniture.items],
  ...["walls", "rooms", "openings", "lights"].map((k) => [
    k,
    doc.layout[k] || [],
  ]),
];
export function identifyObjects(document, initial = false) {
  const seen = new Set();
  for (const [type, items] of collections(document))
    items.forEach((item, i) => {
      if (!item.edit_id || seen.has(item.edit_id))
        item.edit_id = initial
          ? `${type}-${item.id || i}`
          : crypto.randomUUID();
      seen.add(item.edit_id);
    });
  return document;
}
export function lockedChange(previous, next) {
  for (const [type, items] of collections(previous)) {
    const values = new Map(
      collections(next)
        .find(([key]) => key === type)[1]
        .map((i) => [i.edit_id, i]),
    );
    for (const item of items.filter((i) => i.edit_locked)) {
      const after = values.get(item.edit_id);
      if (!after) return "操作涉及已锁定对象，请先解锁。";
      const { edit_locked: beforeLock, ...before } = item,
        { edit_locked: afterLock, ...rest } = after;
      if (JSON.stringify(before) !== JSON.stringify(rest))
        return "相连或组合对象已锁定，请先解锁后再修改。";
    }
  }
  return "";
}

export function designFingerprint(value) {
  if (Array.isArray(value)) return value.map(designFingerprint);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .filter((k) => !k.startsWith("edit_"))
        .sort()
        .map((k) => [k, designFingerprint(value[k])]),
    );
  return value;
}
