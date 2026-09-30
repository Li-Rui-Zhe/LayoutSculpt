import polygonClipping from "polygon-clipping";

export function segmentInside(a, b, polygon) {
  if (!contains(a, polygon) || !contains(b, polygon)) return false;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    ts = [0, 1],
    length2 = dx * dx + dy * dy;
  if (length2 < 1e-12) return true;
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i],
      d = polygon[(i + 1) % polygon.length],
      ex = d.x - c.x,
      ey = d.y - c.y;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) > 1e-10) {
      const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / denominator;
      const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    } else if (Math.abs((c.x - a.x) * dy - (c.y - a.y) * dx) < 1e-8) {
      for (const p of [c, d]) {
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2;
        if (t > 0 && t < 1) ts.push(t);
      }
    }
  }
  ts.sort((a, b) => a - b);
  return ts
    .slice(1)
    .every((t, i) =>
      contains(
        { x: a.x + (dx * (t + ts[i])) / 2, y: a.y + (dy * (t + ts[i])) / 2 },
        polygon,
      ),
    );
}
export function polygonInside(points, polygon) {
  return points.every((a, i) =>
    segmentInside(a, points[(i + 1) % points.length], polygon),
  );
}
const clipRing = (points) => [points.map((p) => [p.x, p.y])];
export function overlapArea(a, b) {
  return polygonClipping
    .intersection(clipRing(a), clipRing(b))
    .reduce(
      (sum, poly) =>
        sum +
        poly.reduce(
          (area, ring, i) =>
            area + (i ? -1 : 1) * polygonArea(ring.map(([x, y]) => ({ x, y }))),
          0,
        ),
      0,
    );
}
function collinearOverlap(a, b) {
  const dx = a.end.x - a.start.x,
    dy = a.end.y - a.start.y,
    len = wallLength(a);
  if (len < 1e-8) return false;
  if (
    [b.start, b.end].some(
      (p) => Math.abs((p.x - a.start.x) * dy - (p.y - a.start.y) * dx) > 1e-7,
    )
  )
    return false;
  const values = [b.start, b.end].map(
    (p) => ((p.x - a.start.x) * dx + (p.y - a.start.y) * dy) / len,
  );
  return (
    Math.min(len, Math.max(...values)) - Math.max(0, Math.min(...values)) > 1e-6
  );
}

export function splitRoom(document, index, axis, coordinate, id) {
  const next = clone(document),
    room = next.layout.rooms[index];
  if (!room || next.layout.rooms.length >= 35)
    throw Error("无法拆分：空间不存在或已达到 35 个空间上限。");
  const rect = (x1, y1, x2, y2) => [
    [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
    ],
  ];
  const halves =
    axis === "x"
      ? [rect(-61, -61, coordinate, 61), rect(coordinate, -61, 61, 61)]
      : [rect(-61, -61, 61, coordinate), rect(-61, coordinate, 61, 61)];
  const parts = halves.map((half) =>
    polygonClipping.intersection(clipRing(room.polygon), half),
  );
  if (parts.some((p) => p.length !== 1 || p[0].length !== 1))
    throw Error("拆分线必须穿过空间，并形成两个连续空间。");
  const rooms = parts.map((part, i) => ({
    ...clone(room),
    id: i ? id : room.id,
    name: `${room.name.slice(0, 55)} ${i + 1}`,
    polygon: part[0][0]
      .slice(0, -1)
      .map(([x, y]) => ({ x: round(x), y: round(y) })),
  }));
  if (rooms.some((r) => polygonArea(r.polygon) < 0.2 || r.polygon.length > 24))
    throw Error("拆分后每个空间至少 0.2 ㎡，最多 24 个角点。");
  for (const f of next.furniture.items.filter((f) => f.room_id === room.id)) {
    const target = rooms.find((r) => itemFits(f, r));
    if (!target) throw Error("拆分线穿过家具，请先移动家具或调整拆分位置。");
    f.room_id = target.id;
  }
  next.layout.rooms.splice(index, 1, ...rooms);
  return next;
}

export function removeObject(document, selected, deleteFurniture = false) {
  const next = clone(document);
  if (selected.type === "rooms") {
    const room = next.layout.rooms[selected.index];
    next.layout.rooms.splice(selected.index, 1);
    const linked = next.furniture.items.filter((f) => f.room_id === room.id);
    if (deleteFurniture)
      next.furniture.items = next.furniture.items.filter(
        (f) => f.room_id !== room.id,
      );
    else
      for (const f of linked) {
        const target = next.layout.rooms.find((r) => itemFits(f, r));
        if (!target)
          throw Error(
            "该空间内的家具无法归属其他空间。请先移动家具，或选择同时删除家具。",
          );
        f.room_id = target.id;
      }
  } else if (selected.type === "walls") {
    const wall = next.layout.walls[selected.index];
    next.layout.openings = next.layout.openings.filter(
      (o) => o.wall_id !== wall.id,
    );
    next.layout.walls.splice(selected.index, 1);
  } else if (selected.type === "furniture")
    next.furniture.items.splice(selected.index, 1);
  else if (selected.type === "lights")
    next.layout.lights.splice(selected.index, 1);
  else if (selected.type === "openings")
    next.layout.openings.splice(selected.index, 1);
  return next;
}

export function toolFor(type, item) {
  return type === "openings" && item?.kind === "passage" ? "passages" : type;
}
export function objectEntries(document, tool) {
  if (tool === "outline")
    return [
      {
        type: "outline",
        index: 0,
        object: { name: "户型轮廓", polygon: document.layout.outline },
      },
    ];
  const type = tool === "passages" ? "openings" : tool;
  const list =
    type === "furniture" ? document.furniture.items : document.layout[type];
  return list
    .map((object, index) => ({ type, index, object }))
    .filter(
      ({ object }) =>
        type !== "openings" ||
        (tool === "passages"
          ? object.kind === "passage"
          : object.kind !== "passage"),
    );
}

export function searchEntries(entries, query, rooms = []) {
  const q = query.trim().toLocaleLowerCase();
  return entries.filter(
    ({ object, index, type }) =>
      !q ||
      [
        object.name,
        object.id,
        index + 1,
        furnitureNames[object.kind],
        openingNames[object.kind],
        lightNames[object.kind],
        rooms.find((r) => r.id === object.room_id)?.name,
        type === "walls" ? (object.exterior ? "外墙" : "隔墙") : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(q),
  );
}

export function doorLeafPoints(opening, wall) {
  const [a, b] = openingPoints(opening, wall),
    hinge = opening.hinge === "end" ? b : a,
    other = opening.hinge === "end" ? a : b;
  const angle =
    (((opening.angle ?? 90) * Math.PI) / 180) *
    (opening.swing === "right" ? 1 : -1);
  const dx = other.x - hinge.x,
    dy = other.y - hinge.y;
  return [
    hinge,
    {
      x: hinge.x + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: hinge.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    },
  ];
}
export const lightNames = {
  bulb: "灯泡",
  pendant: "吊灯",
  floor_lamp: "落地灯",
};
export const lightColors = {
  2700: "#ffba70",
  3000: "#ffd091",
  4000: "#ffe4bb",
  6500: "#e3f0ff",
};
export const furnitureNames = {
  sofa: "沙发",
  bed: "床",
  table: "餐桌",
  chair: "椅子",
  cabinet: "柜子",
  counter: "操作台",
  bathtub: "浴缸",
  toilet: "马桶",
  sink: "洗手台",
  plant: "绿植",
  rug: "地毯",
  desk: "书桌",
};
export const openingNames = {
  door: "门",
  window: "窗户",
  passage: "开放通道",
};
export const floorFinishes = {
  default: "沿用原方案",
  oak: "自然橡木",
  walnut: "深色木地板",
  tile: "浅色瓷砖",
  stone: "灰色石材",
};
export const wallFinishes = {
  default: "沿用原方案",
  white: "暖白",
  cream: "奶油色",
  sage: "鼠尾草绿",
  gray: "浅灰",
};
export const roomNames = {
  living: "客厅",
  dining: "餐厅",
  bedroom: "卧室",
  kitchen: "厨房",
  bathroom: "卫生间",
  balcony: "阳台",
  hall: "走廊 / 通道",
  study: "书房",
  other: "其他空间",
};
export const round = (value) => Math.round(value * 1000) / 1000;
export const clone = (value) => structuredClone(value);
export const wallLength = (wall) =>
  Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
export const polygonArea = (points) =>
  Math.abs(
    points.reduce((sum, a, i) => {
      const b = points[(i + 1) % points.length];
      return sum + a.x * b.y - b.x * a.y;
    }, 0) / 2,
  );
export function center(points) {
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
}
export function bounds(layout) {
  const points = [
    ...layout.outline,
    ...layout.walls.flatMap((wall) => [wall.start, wall.end]),
  ];
  const minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)),
    maxY = Math.max(...points.map((p) => p.y));
  return {
    x: minX - 0.8,
    y: minY - 0.8,
    width: Math.max(3, maxX - minX + 1.6),
    height: Math.max(3, maxY - minY + 1.6),
  };
}
export function toDraft(data) {
  return {
    layout: Object.fromEntries(
      [
        "title",
        "confidence",
        "scale_note",
        "warnings",
        "outline",
        "rooms",
        "walls",
        "openings",
        "lights",
      ].map((key) => [
        key,
        clone(key === "lights" ? data.lights || [] : data[key]),
      ]),
    ),
    furniture: {
      items: clone(data.furniture),
      notes: clone(data.furniture_notes || []),
    },
  };
}
export function contains(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (
      Math.abs(cross) < 1e-6 &&
      point.x >= Math.min(a.x, b.x) - 1e-6 &&
      point.x <= Math.max(a.x, b.x) + 1e-6 &&
      point.y >= Math.min(a.y, b.y) - 1e-6 &&
      point.y <= Math.max(a.y, b.y) + 1e-6
    )
      return true;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export function furnitureCorners(item) {
  const angle = (item.rotation * Math.PI) / 180;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([dx, dy]) => ({
    x:
      item.x +
      (Math.cos(angle) * dx * item.width) / 2 -
      (Math.sin(angle) * dy * item.depth) / 2,
    y:
      item.y +
      (Math.sin(angle) * dx * item.width) / 2 +
      (Math.cos(angle) * dy * item.depth) / 2,
  }));
}
export function itemFits(item, room) {
  return polygonInside(furnitureCorners(item), room.polygon);
}
function distanceToWall(point, wall) {
  const dx = wall.end.x - wall.start.x,
    dy = wall.end.y - wall.start.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) /
        (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(
    point.x - wall.start.x - dx * t,
    point.y - wall.start.y - dy * t,
  );
}
export function moveWall(document, index, dx, dy, endpoint = null) {
  const next = clone(document),
    wall = document.layout.walls[index];
  const anchors = endpoint ? [wall[endpoint]] : [wall.start, wall.end];
  const shift = (point) => ({ x: round(point.x + dx), y: round(point.y + dy) });
  const nearAnchor = (p, tolerance) =>
    anchors.some((a) => Math.hypot(a.x - p.x, a.y - p.y) <= tolerance);
  next.layout.walls.forEach((item, i) => {
    for (const key of ["start", "end"])
      if (
        (i === index && (!endpoint || endpoint === key)) ||
        nearAnchor(item[key], 0.025)
      )
        item[key] = shift(item[key]);
  });
  const close = (p, tolerance) =>
    endpoint ? nearAnchor(p, tolerance) : distanceToWall(p, wall) <= tolerance;
  next.layout.rooms.forEach((room) => {
    room.polygon = room.polygon.map((p) =>
      close(p, wall.thickness + 0.06) ? shift(p) : p,
    );
  });
  if (wall.exterior)
    next.layout.outline = next.layout.outline.map((p) =>
      close(p, 0.03) ? shift(p) : p,
    );
  return next;
}
export function moveSelection(document, selected, dx, dy, handle = null) {
  if (selected.type === "walls")
    return moveWall(document, selected.index, dx, dy, handle);
  const next = clone(document);
  if (selected.type === "furniture") {
    const item = next.furniture.items[selected.index];
    item.x = round(item.x + dx);
    item.y = round(item.y + dy);
    const oldRoom = next.layout.rooms.find((room) => room.id === item.room_id);
    if (!oldRoom || !itemFits(item, oldRoom)) {
      const room = next.layout.rooms.find((room) => itemFits(item, room));
      if (room) item.room_id = room.id;
    }
  } else if (selected.type === "rooms") {
    if (handle === null) {
      next.layout.rooms[selected.index].polygon.forEach((p) => {
        p.x = round(p.x + dx);
        p.y = round(p.y + dy);
      });
      return next;
    }
    const point = next.layout.rooms[selected.index].polygon[handle];
    point.x = round(point.x + dx);
    point.y = round(point.y + dy);
  } else if (selected.type === "lights") {
    const light = next.layout.lights[selected.index];
    light.x = round(light.x + dx);
    light.y = round(light.y + dy);
  } else if (selected.type === "outline") {
    const points =
      handle === null ? next.layout.outline : [next.layout.outline[handle]];
    points.forEach((p) => {
      p.x = round(p.x + dx);
      p.y = round(p.y + dy);
    });
  } else if (selected.type === "openings") {
    const opening = next.layout.openings[selected.index],
      wall = next.layout.walls.find((w) => w.id === opening.wall_id);
    const length = wallLength(wall);
    const along =
      (dx * (wall.end.x - wall.start.x) + dy * (wall.end.y - wall.start.y)) /
      (length || 1);
    opening.offset = round(
      Math.max(0, Math.min(length - opening.width, opening.offset + along)),
    );
  }
  return next;
}
export function openingPoints(opening, wall) {
  const length = wallLength(wall) || 1;
  const point = (offset) => ({
    x: wall.start.x + ((wall.end.x - wall.start.x) * offset) / length,
    y: wall.start.y + ((wall.end.y - wall.start.y) * offset) / length,
  });
  return [point(opening.offset), point(opening.offset + opening.width)];
}
export function freeOpening(layout, wall, kind) {
  if (!wall) return null;
  const length = wallLength(wall),
    width = kind === "window" ? 1.2 : 0.9;
  const openings = layout.openings
    .filter((o) => o.wall_id === wall.id)
    .sort((a, b) => a.offset - b.offset);
  let start = 0.1;
  for (const item of openings) {
    if (item.offset - start >= width + 0.1) break;
    start = Math.max(start, item.offset + item.width + 0.1);
  }
  if (length - start < width + 0.1) return null;
  const bottom = kind === "window" ? 0.9 : 0;
  return {
    wall_id: wall.id,
    kind,
    offset: round(start),
    width,
    bottom,
    height: Math.min(kind === "window" ? 1.2 : 2.1, wall.height - bottom),
  };
}
export function problems(document) {
  const issues = [],
    { layout, furniture } = document;
  if (!simplePolygon(layout.outline) || polygonArea(layout.outline) < 2)
    issues.push({
      type: "outline",
      index: 0,
      text: "户型轮廓自交、折返或面积不足 2 ㎡。",
    });
  const validPoint = (p) =>
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Math.abs(p.x) <= 60 &&
    Math.abs(p.y) <= 60;
  if (!layout.outline.every(validPoint))
    issues.push({
      type: "outline",
      index: 0,
      text: "轮廓坐标必须在 -60～60 米之间。",
    });
  layout.walls.forEach((wall, index) => {
    if (
      !validPoint(wall.start) ||
      !validPoint(wall.end) ||
      !segmentInside(wall.start, wall.end, layout.outline)
    )
      issues.push({
        type: "walls",
        index,
        text: `墙体 ${index + 1} 中心线超出户型轮廓或坐标范围。`,
      });
    if (
      layout.walls.some(
        (other, j) => j < index && collinearOverlap(wall, other),
      )
    )
      issues.push({
        type: "walls",
        index,
        text: `墙体 ${index + 1} 与其他墙体存在重叠线段。`,
      });
    if (wallLength(wall) < 0.05)
      issues.push({
        type: "walls",
        index,
        text: `墙体 ${index + 1} 太短，请移动端点。`,
      });
  });
  layout.rooms.forEach((room, index) => {
    if (!room.polygon.every(validPoint))
      issues.push({
        type: "rooms",
        index,
        text: `${room.name} 的角点超出坐标范围。`,
      });
    if (simplePolygon(room.polygon))
      for (let j = 0; j < index; j++) {
        const other = layout.rooms[j];
        if (
          simplePolygon(other.polygon) &&
          overlapArea(room.polygon, other.polygon) > 1e-6
        )
          issues.push({
            type: "rooms",
            index,
            text: `${room.name} 与 ${other.name} 重叠，请移动、修改边界或拆分空间。`,
          });
      }
    if (!room.name.trim() || !simplePolygon(room.polygon))
      issues.push({
        type: "rooms",
        index,
        text: `${room.name || "空间"} 的名称为空或地板边界交叉，请调整角点。`,
      });
    if (
      polygonArea(room.polygon) < 0.2 ||
      !polygonInside(room.polygon, layout.outline)
    )
      issues.push({
        type: "rooms",
        index,
        text: `${room.name} 的地板超出外轮廓或面积过小。`,
      });
  });
  furniture.items.forEach((item, index) => {
    if (!validPoint(item))
      issues.push({
        type: "furniture",
        index,
        text: `家具 ${index + 1} 的坐标超出 -60～60 米范围。`,
      });
    const room = layout.rooms.find((r) => r.id === item.room_id);
    if (!room || !itemFits(item, room))
      issues.push({
        type: "furniture",
        index,
        text: `${furnitureNames[item.kind]} ${index + 1} 超出所属房间，请移动、缩小或切换所属空间。`,
      });
  });
  layout.openings.forEach((opening, index) => {
    const wall = layout.walls.find((w) => w.id === opening.wall_id);
    if (
      !wall ||
      opening.offset + opening.width > wallLength(wall) + 1e-6 ||
      opening.bottom + opening.height > wall.height + 1e-6
    )
      issues.push({
        type: "openings",
        index,
        text: `${openingNames[opening.kind]} ${index + 1} 超出墙体范围。`,
      });
    if (
      layout.openings.some(
        (other, j) =>
          j < index &&
          other.wall_id === opening.wall_id &&
          opening.offset < other.offset + other.width - 1e-6 &&
          other.offset < opening.offset + opening.width - 1e-6,
      )
    )
      issues.push({
        type: "openings",
        index,
        text: `${openingNames[opening.kind]} ${index + 1} 与其他门窗或通道重叠。`,
      });
  });
  (layout.lights || []).forEach((light, index) => {
    if (
      !light.name.trim() ||
      !validPoint(light) ||
      !contains(light, layout.outline)
    )
      issues.push({
        type: "lights",
        index,
        text: `灯具 ${light.name} 名称为空或位置超出户型轮廓。`,
      });
  });
  return issues;
}

export function simplePolygon(points) {
  for (let i = 0; i < points.length; i++) {
    const a = points[(i + points.length - 1) % points.length],
      b = points[i],
      c = points[(i + 1) % points.length];
    if (
      Math.abs((a.x - b.x) * (c.y - b.y) - (a.y - b.y) * (c.x - b.x)) < 1e-9 &&
      (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) > 1e-9
    )
      return false;
  }
  if (new Set(points.map((p) => `${p.x},${p.y}`)).size !== points.length)
    return false;
  const cross = (a, b, c) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < points.length; i++)
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const a = points[i],
        b = points[(i + 1) % points.length],
        c = points[j],
        d = points[(j + 1) % points.length];
      if (
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) >
          Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) + 1e-7 ||
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) >
          Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) + 1e-7
      )
        continue;
      if (
        cross(a, b, c) * cross(a, b, d) <= 0 &&
        cross(c, d, a) * cross(c, d, b) <= 0
      )
        return false;
    }
  return true;
}

// 草稿允许暂时存在几何问题，但损坏的数据结构不能进入编辑器。
export function restorableDraft(doc) {
  const point = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const polygon = (p) => Array.isArray(p) && p.length >= 3 && p.every(point);
  const l = doc?.layout,
    f = doc?.furniture;
  return !!(
    l &&
    polygon(l.outline) &&
    Array.isArray(l.rooms) &&
    l.rooms.every(
      (r) =>
        r &&
        typeof r.name === "string" &&
        typeof r.id === "string" &&
        polygon(r.polygon),
    ) &&
    Array.isArray(l.walls) &&
    l.walls.every(
      (w) =>
        w &&
        point(w.start) &&
        point(w.end) &&
        Number.isFinite(w.height) &&
        Number.isFinite(w.thickness),
    ) &&
    Array.isArray(l.openings) &&
    l.openings.every(
      (o) =>
        o &&
        openingNames[o.kind] &&
        l.walls.some((w) => w.id === o.wall_id) &&
        [o.offset, o.width, o.height, o.bottom].every(Number.isFinite),
    ) &&
    (l.lights === undefined ||
      (Array.isArray(l.lights) &&
        l.lights.length <= 12 &&
        l.lights.every(
          (light) =>
            light &&
            typeof light.name === "string" &&
            lightNames[light.kind] &&
            [
              light.x,
              light.y,
              light.elevation,
              light.lumens,
              light.temperature,
            ].every(Number.isFinite),
        ))) &&
    Array.isArray(f?.items) &&
    f.items.every(
      (i) =>
        i &&
        furnitureNames[i.kind] &&
        [i.x, i.y, i.width, i.depth, i.height, i.rotation].every(
          Number.isFinite,
        ),
    )
  );
}
