import test from "node:test";
import assert from "node:assert/strict";
import { progressLifecycle as update } from "../src/components/progressLifecycle.js";

test("慢操作显示进度后，须动画到100再进入停留阶段；快速操作不补闪完成框", () => {
  let state = update({ run: 0, phase: "idle" }, { type: "start" });
  assert.equal(update(state, { type: "success" }).phase, "idle");
  state = update(state, { type: "show", run: 1 });
  state = update(state, { type: "success" });
  assert.equal(state.phase, "finishing");
  state = update(state, { type: "settle", run: 1 });
  assert.equal(state.phase, "settled");
  state = update(state, { type: "stop", run: 1 });
  assert.equal(state.phase, "idle");
});

test("失败取消立即结束，重试与切换任务拒绝上次操作迟到的定时器和完成回调", () => {
  let state = update({ run: 0, phase: "idle" }, { type: "start" });
  state = update(state, { type: "show", run: 1 });
  state = update(state, { type: "stop" });
  assert.equal(update(state, { type: "success" }).phase, "idle");
  state = update(state, { type: "start" });
  for (const type of ["show", "settle", "stop"])
    assert.equal(update(state, { type, run: 1 }), state);
  assert.equal(update(state, { type: "show", run: 2 }).phase, "running");
});
