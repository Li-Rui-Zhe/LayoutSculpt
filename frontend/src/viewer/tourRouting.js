import { walkAreaError, WALK_RADIUS } from "./tourWalking.js";
import { insideRoom } from "./tourGeometry.js";

// 栅格只用于找路；每一段仍做连续碰撞检测，避免斜穿薄墙或建筑构件。
export function createWalkRouter(regions, obstacles) {
  const buckets = new Map();
  for (const obstacle of obstacles) {
    for (let x = Math.floor(obstacle.minX); x <= Math.floor(obstacle.maxX); x++)
      for (
        let y = Math.floor(obstacle.minY);
        y <= Math.floor(obstacle.maxY);
        y++
      ) {
        const key = `${x},${y}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(obstacle);
      }
  }
  const error = (a, b) => {
    const nearby = new Set();
    for (
      let x = Math.floor(Math.min(a.x, b.x) - WALK_RADIUS);
      x <= Math.floor(Math.max(a.x, b.x) + WALK_RADIUS);
      x++
    )
      for (
        let y = Math.floor(Math.min(a.y, b.y) - WALK_RADIUS);
        y <= Math.floor(Math.max(a.y, b.y) + WALK_RADIUS);
        y++
      )
        for (const obstacle of buckets.get(`${x},${y}`) || [])
          nearby.add(obstacle);
    return walkAreaError(a, b, regions, [...nearby]);
  };
  return (from, to) => {
    const directError = error(from, to);
    if (!directError) return { points: [from, to] };
    // 无效终点不绕路，也不将用户传送到另一侧的独立地面。
    if (error(to, to))
      return { error: "这个位置太靠近墙面或建筑构件，请点旁边的地面。" };
    if (!regions.some((r) => insideRoom(from, r[0]) && insideRoom(to, r[0])))
      return { error: directError };
    if (error(from, from))
      return { error: "当前位置空间不足，请用房间地图重新进入。" };

    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const step = 0.18,
      heap = [],
      nodes = new Map();
    const push = (entry) => {
      let i = heap.length;
      heap.push(entry);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent].score <= entry.score) break;
        heap[i] = heap[parent];
        i = parent;
      }
      heap[i] = entry;
    };
    const pop = () => {
      const first = heap[0],
        last = heap.pop();
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (
            child + 1 < heap.length &&
            heap[child + 1].score < heap[child].score
          )
            child++;
          if (last.score <= heap[child].score) break;
          heap[i] = heap[child];
          i = child;
        }
        heap[i] = last;
      }
      return first;
    };
    const first = { x: from.x, y: from.y, ix: 0, iy: 0, cost: 0 };
    nodes.set("0,0", first);
    push({ node: first, cost: 0, score: distance(from, to) });
    let visited = 0;
    while (heap.length && visited++ < 16000) {
      const entry = pop(),
        current = entry.node;
      if (current.closed || entry.cost !== current.cost) continue;
      current.closed = true;
      if (distance(current, to) < step * 2 && !error(current, to)) {
        const path = [to];
        for (let n = current; n; n = n.parent) path.push({ x: n.x, y: n.y });
        path.reverse();
        // 拉直能直达的路段，行走不沿小格子左右抖动。
        const points = [path[0]];
        for (let i = 0; i < path.length - 1;) {
          let next = path.length - 1;
          while (next > i + 1 && error(path[i], path[next])) next--;
          points.push(path[next]);
          i = next;
        }
        return { points };
      }
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue;
          const ix = current.ix + dx,
            iy = current.iy + dy,
            key = `${ix},${iy}`;
          let next = nodes.get(key);
          if (!next) {
            next = {
              x: from.x + ix * step,
              y: from.y + iy * step,
              ix,
              iy,
              cost: Infinity,
            };
            next.blocked = !!error(next, next);
            nodes.set(key, next);
          }
          const cost = current.cost + Math.hypot(dx, dy) * step;
          if (
            next.closed ||
            next.blocked ||
            cost >= next.cost ||
            error(current, next)
          )
            continue;
          next.cost = cost;
          next.parent = current;
          push({ node: next, cost, score: cost + distance(next, to) });
        }
    }
    return { error: "这里暂时没有可通过的路线，请换个落点或使用房间地图。" };
  };
}

// 以整条路线的距离插值，绕过拐角后不会每走一步重新启停。
export function routePosition(points, fraction) {
  const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
  const t = Math.max(0, Math.min(1, fraction));
  if (t === 1) return points.at(-1).clone();
  let remaining = lengths.reduce((sum, n) => sum + n, 0) * t * t * (3 - 2 * t);
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i])
      return points[i]
        .clone()
        .lerp(points[i + 1], lengths[i] ? remaining / lengths[i] : 1);
    remaining -= lengths[i];
  }
  return points.at(-1).clone();
}
