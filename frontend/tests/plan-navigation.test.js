import test from "node:test";
import assert from "node:assert/strict";
import { zoomPlan, panPlan } from "../src/editor/planNavigation.js";

test("鼠标锚点在平移后的连续缩放和缩放上限处保持不动", () => {
  const box = { x: -2, y: -1, width: 10, height: 18 };
  const anchor = { x: 6, y: 11 };
  let view = { zoom: 1.4, center: { x: 3, y: 7 } };
  const expected = {
    x: (anchor.x - view.center.x) * view.zoom,
    y: (anchor.y - view.center.y) * view.zoom,
  };
  for (const factor of [1.3, 1.2, 100, 0.5, 0.1, 0.8, 1.5]) {
    view = zoomPlan(view, box, factor, anchor);
    assert.ok(
      Math.abs((anchor.x - view.center.x) * view.zoom - expected.x) < 1e-10,
    );
    assert.ok(
      Math.abs((anchor.y - view.center.y) * view.zoom - expected.y) < 1e-10,
    );
    assert.ok(view.zoom >= 0.5 && view.zoom <= 8);
  }
  const limited = { zoom: 8, center: anchor };
  assert.equal(zoomPlan(limited, box, 2, anchor), limited);
});

test("工具按钮围绕当前中心缩放，拖动画布不累积偏移或修改输入", () => {
  const box = { x: -3, y: 2, width: 10, height: 12 };
  const original = { zoom: 1, center: null };
  const zoomed = zoomPlan(original, box, 2);
  assert.deepEqual(zoomed, { zoom: 2, center: { x: 2, y: 8 } });
  const origin = { x: 1, y: 5 };
  assert.deepEqual(panPlan(zoomed.center, origin, { x: 4, y: 3 }), {
    x: -1,
    y: 10,
  });
  assert.deepEqual(panPlan(zoomed.center, origin, { x: 6, y: 4 }), {
    x: -3,
    y: 9,
  });
  assert.deepEqual(original, { zoom: 1, center: null });
  assert.deepEqual(zoomed.center, { x: 2, y: 8 });
});
