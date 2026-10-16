import test from "node:test";
import assert from "node:assert/strict";
import { canvasPoint, paintMark } from "../src/diy/paintTools.js";

test("缩放画布坐标按真实纹理尺寸映射并限制边界", () => {
  const rect = { left: 100, top: 50, width: 512, height: 512 };
  assert.deepEqual(canvasPoint(rect, 356, 306), { x: 512, y: 512 });
  assert.deepEqual(canvasPoint(rect, -10, 999), { x: 0, y: 1024 });
});

function context() {
  const offsets = [],
    ellipses = [],
    composites = [];
  return {
    offsets,
    ellipses,
    composites,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    rect() {},
    translate(x, y) {
      offsets.push([x, y]);
    },
    ellipse(...args) {
      ellipses.push(args);
    },
    set globalCompositeOperation(value) {
      composites.push(value);
    },
  };
}

test("跨边绘图覆盖相邻八块纹理，关闭后只画本块", () => {
  const ctx = context(),
    p = { x: 0, y: 0 };
  paintMark(
    ctx,
    p,
    { x: 20, y: 20 },
    { tool: "brush", color: "#aaaaaa", width: 4, opacity: 0.5 },
  );
  assert.equal(ctx.offsets.length, 9);
  assert.ok(ctx.offsets.some(([x, y]) => x === 1024 && y === 0));
  ctx.offsets.length = 0;
  paintMark(ctx, p, p, { tool: "eraser", width: 10, wrap: false });
  assert.deepEqual(ctx.offsets, [[0, 0]]);
  assert.equal(ctx.composites.at(-1), "destination-out");
});

test("反向拖拽和零距离椭圆不产生负半径或异常", () => {
  const ctx = context();
  paintMark(
    ctx,
    { x: 100, y: 100 },
    { x: 20, y: 40 },
    { tool: "ellipse", width: 5, wrap: false },
  );
  assert.deepEqual(ctx.ellipses[0].slice(0, 4), [60, 70, 40, 30]);
  paintMark(
    ctx,
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { tool: "ellipse", width: 5, wrap: false },
  );
  assert.ok(ctx.ellipses[1][2] > 0);
});
