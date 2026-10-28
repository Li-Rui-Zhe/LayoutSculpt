import test from "node:test";
import assert from "node:assert/strict";
import { createFrameRenderer } from "../src/viewer/frameRenderer.js";

test("多次更新每帧只绘制一次；首次就绪立即绘制；销毁取消未执行帧", (t) => {
  let serial = 0, draws = 0;
  const pending = new Map();
  const request = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame;
  t.after(() => { globalThis.requestAnimationFrame = request; globalThis.cancelAnimationFrame = cancel; });
  globalThis.requestAnimationFrame = (fn) => { pending.set(++serial, fn); return serial; };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);
  const frames = createFrameRenderer(() => draws++);
  for (let i = 0; i < 20; i++) frames.request();
  assert.equal(pending.size, 1);
  assert.equal(draws, 0);
  [...pending.values()][0]();
  assert.equal(draws, 1);
  assert.equal(pending.size, 0);
  frames.request(); frames.flush();
  assert.equal(draws, 2);
  assert.equal(pending.size, 0);
  frames.request(); frames.close(); frames.request(); frames.flush();
  assert.equal(draws, 2);
  assert.equal(pending.size, 0);
});
