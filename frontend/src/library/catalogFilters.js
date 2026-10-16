export const roomOrder = [
  "客厅",
  "卧室",
  "餐厅",
  "书房",
  "儿童房",
  "玄关",
  "厨房",
  "卫浴",
  "阳台",
  "装饰",
];

export function inRoom(item, room) {
  return (
    room === "all" ||
    item.category === room ||
    Boolean(item.rooms?.includes(room))
  );
}

export function matchesCatalog(
  item,
  {
    source = "all",
    category = "all",
    family = "all",
    style = "all",
    query = "",
    maxWidth = "",
  } = {},
) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [
    item.name,
    item.filename,
    item.category,
    item.family,
    item.variant,
    item.style,
    ...(item.tags || []),
    ...(item.rooms || []),
  ]
    .join(" ")
    .toLocaleLowerCase();
  return (
    (source === "all" || item.source === source) &&
    inRoom(item, category) &&
    (family === "all" || item.family === family) &&
    (style === "all" || item.style === style) &&
    (!maxWidth ||
      Boolean(item.dimensions && item.dimensions[0] <= Number(maxWidth))) &&
    words.every((word) => text.includes(word))
  );
}

export function catalogFacets(items, source, category = "all") {
  const scope = items.filter((i) => source === "all" || i.source === source);
  const rooms = [
    ...new Set(
      scope
        .flatMap((i) => (i.rooms?.length ? i.rooms : [i.category]))
        .filter(Boolean),
    ),
  ];
  rooms.sort(
    (a, b) =>
      (roomOrder.indexOf(a) < 0 ? 99 : roomOrder.indexOf(a)) -
        (roomOrder.indexOf(b) < 0 ? 99 : roomOrder.indexOf(b)) ||
      a.localeCompare(b, "zh-CN"),
  );
  const scoped = scope.filter((i) => inRoom(i, category));
  return {
    rooms,
    families: [...new Set(scoped.map((i) => i.family).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, "zh-CN"),
    ),
    styles: [...new Set(scoped.map((i) => i.style).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, "zh-CN"),
    ),
  };
}

export const dimensionLabel = (item) =>
  item.dimensions
    ? item.dimensions.map((n) => Math.round(n * 100)).join(" × ") + " cm"
    : "尺寸待读取";
