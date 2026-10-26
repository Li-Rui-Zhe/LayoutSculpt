import test from "node:test";
import assert from "node:assert/strict";
import { interactionQuality } from "../src/viewer/interactionQuality.js";

test("拖动合并画质切换，连续手势不提前恢复，结束后恢复清晰度", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const q = interactionQuality({ ratio: 2, apply: (r) => calls.push(r) });
  q.start();
  q.start();
  q.end();
  t.mock.timers.tick(100);
  q.start();
  t.mock.timers.tick(500);
  assert.deepEqual(calls, [1.25]);
  q.end();
  t.mock.timers.tick(220);
  assert.deepEqual(calls, [1.25, 2]);
  q.close();
});
test("截图立即恢复，卸载后不能访问已销毁渲染器，普通分辨率不反复分配", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const q = interactionQuality({ ratio: 3, apply: (r) => calls.push(r) });
  q.start();
  q.end();
  q.restore();
  q.start();
  q.end();
  q.close();
  t.mock.timers.tick(1000);
  assert.deepEqual(calls, [1.25, 2, 1.25]);
  const low = interactionQuality({
    ratio: 1,
    apply: () => assert.fail("不用重置画布"),
  });
  low.start();
  low.end();
  t.mock.timers.tick(1000);
  low.close();
});
