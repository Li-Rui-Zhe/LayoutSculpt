import test from "node:test";
import assert from "node:assert/strict";
import {
  progressTween,
  PROGRESS_FINISH_MS,
} from "../src/components/progressMotion.js";

test("快速完成从12%连续到100%，中间帧和终点一致", () => {
  const values = Array.from({ length: 33 }, (_, i) =>
    progressTween(12, 100, (i * PROGRESS_FINISH_MS) / 32, PROGRESS_FINISH_MS),
  );
  assert.equal(values[0], 12);
  assert.equal(values.at(-1), 100);
  assert.ok(values.slice(1, -1).every((v, i) => v > values[i] && v < 100));
});

test("未就绪的估算永不到100%，切阶段的较低估值不会使进度倒退", () => {
  for (const elapsed of [0, 100, 200, 10000]) {
    assert.ok(progressTween(12, 76, elapsed, 200) <= 76);
    assert.equal(progressTween(91, 80, elapsed, 200), 91);
    assert.ok(progressTween(91, 98, elapsed, 200) < 100);
  }
});
