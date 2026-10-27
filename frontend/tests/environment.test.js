import test from "node:test";
import assert from "node:assert/strict";
import {
  environmentTarget,
  blendEnvironment,
  normalizeEnvironment,
} from "../src/viewer/environment.js";

test("环境兼容旧设置，未知值回退晴天；光强输入不产生无效渲染值", () => {
  assert.equal(normalizeEnvironment("evening"), "sunset");
  assert.equal(normalizeEnvironment("morning"), "midday");
  assert.equal(normalizeEnvironment("overcast"), "midday");
  assert.deepEqual(environmentTarget("overcast"), environmentTarget("midday"));
  assert.equal(normalizeEnvironment(null), "midday");
  for (const value of [-20, 130, NaN, undefined]) {
    const target = environmentTarget("unknown", value);
    assert.ok(Number.isFinite(target.sun) && target.sun >= 0);
  }
});

test("晴天、日落和夜晚各有独立光照，夜晚才启用灯具", () => {
  const sun = environmentTarget("midday"),
    dusk = environmentTarget("sunset"),
    night = environmentTarget("night");
  assert.ok(dusk.position.y < sun.position.y);
  assert.notEqual(dusk.background.getHex(), sun.background.getHex());
  assert.ok(night.sun < sun.sun);
  assert.deepEqual(
    [sun.fixtures, dusk.fixtures, night.fixtures],
    [0, 0, 1],
  );
});

test("过渡从当前帧连续到目标，不污染端点；快速改选可从中间帧继续", () => {
  const start = environmentTarget("midday"),
    end = environmentTarget("night");
  const original = start.sunColor.clone();
  assert.deepEqual(blendEnvironment(start, end, 0), start);
  assert.deepEqual(blendEnvironment(start, end, 1), end);
  const middle = blendEnvironment(start, end, 0.5);
  assert.ok(middle.sun < start.sun && middle.sun > end.sun);
  assert.equal(middle.fixtures, 0.5);
  const next = environmentTarget("sunset");
  assert.deepEqual(blendEnvironment(middle, next, 0), middle);
  assert.deepEqual(blendEnvironment(middle, next, 1), next);
  assert.deepEqual(start.sunColor, original);
});

test("样板间日光按窗向布置，普通项目与夜晚预设不受影响", () => {
  const original = environmentTarget("midday");
  const sample = environmentTarget("midday", 74, true);
  assert.ok(sample.position.z < 0 && original.position.z > 0);
  assert.deepEqual(environmentTarget("midday"), original);
  assert.deepEqual(environmentTarget("night", 74, true), environmentTarget("night"));
});
