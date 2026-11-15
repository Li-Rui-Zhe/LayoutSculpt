import test from "node:test";
import assert from "node:assert/strict";
import { validInteriorDraft } from "../src/hooks/interiorDraft.js";
import {
  elapsedLabel,
  filterInteriorImages,
  pollInteriorHistory,
} from "../src/components/interiorImageState.js";

test("取景草稿保留截图、描述与任务身份，只恢复本机底图", () => {
  const value = {
    reference: { image: "data:image/jpeg;base64,abc", projectId: "sample" },
    prompt: "夜晚",
    submissionId: "a".repeat(32),
  };
  assert.deepEqual(validInteriorDraft(value), {
    ...value,
    exterior: "auto",
    exteriorDescription: "",
  });
  const custom = {
    ...value,
    exterior: "custom",
    exteriorDescription: "远处的湖岸",
  };
  assert.deepEqual(validInteriorDraft(custom), custom);
  assert.equal(
    validInteriorDraft({
      reference: { image: "https://outside.test/private" },
    }),
    null,
  );
  assert.equal(
    validInteriorDraft({ reference: { image: "javascript:alert(1)" } }),
    null,
  );
  assert.equal(
    validInteriorDraft({
      reference: { image: "/api/interior-images/../../view.jpg" },
    }),
    null,
  );
  assert.ok(
    validInteriorDraft({
      reference: { image: `/api/interior-images/${"b".repeat(32)}/view.jpg` },
    }),
  );
  assert.equal(
    validInteriorDraft({ ...value, prompt: "x".repeat(1300) }).prompt.length,
    1200,
  );
});
test("图库筛选区分归档、项目与历史记录", () => {
  const records = [
    {
      id: "a",
      prompt: "自然光",
      context: { projectId: "sample", title: "示例", roomName: "客厅" },
    },
    { id: "b", prompt: "自然光", archived: true },
    { id: "c", prompt: "夜景" },
  ];
  assert.deepEqual(
    filterInteriorImages(records, { query: "客厅", project: "sample" }).map(
      (v) => v.id,
    ),
    ["a"],
  );
  assert.deepEqual(
    filterInteriorImages(records, { archived: true }).map((v) => v.id),
    ["b"],
  );
  assert.deepEqual(
    filterInteriorImages(records, { project: "legacy" }).map((v) => v.id),
    ["c"],
  );
});
test("等待时间不冒充生成百分比，异常时间不会显示 NaN", () => {
  assert.equal(
    elapsedLabel("2026-11-12T00:00:00Z", Date.parse("2026-11-12T00:01:23Z")),
    "已等待 1 分 23 秒",
  );
  assert.equal(elapsedLabel("bad"), "正在处理");
});
const settle = () => new Promise((resolve) => setImmediate(resolve));
test("首次读取失败仍能自动恢复，完成后停止轮询", async () => {
  let attempts = 0;
  const pending = [],
    errors = [],
    received = [];
  const stop = pollInteriorHistory({
    load: async () => {
      if (++attempts === 1) throw Error("offline");
      return { items: [{ status: attempts === 2 ? "generating" : "ready" }] };
    },
    onData: (v) => received.push(v),
    onError: (_, retrying) => errors.push(retrying),
    schedule: (fn, ms) => {
      pending.push({ fn, ms });
      return pending.length;
    },
    unschedule() {},
  });
  await settle();
  assert.equal(pending[0].ms, 2000);
  assert.deepEqual(errors, [true]);
  await pending.shift().fn();
  assert.equal(received[0].items[0].status, "generating");
  await pending.shift().fn();
  assert.equal(received[1].items[0].status, "ready");
  assert.equal(pending.length, 0);
  stop();
});
test("连续读取失败有限重试，退出后不再更新页面", async () => {
  const pending = [],
    errors = [];
  const stop = pollInteriorHistory({
    load: async () => {
      throw Error("offline");
    },
    onData() {
      assert.fail();
    },
    onError: (_, r) => errors.push(r),
    schedule: (fn) => pending.push(fn),
    unschedule() {},
  });
  await settle();
  while (pending.length) await pending.shift()();
  assert.deepEqual(errors, [true, true, true, false]);
  stop();
  let resolve;
  let updates = 0;
  const cleanup = pollInteriorHistory({
    load: () => new Promise((r) => (resolve = r)),
    onData: () => updates++,
    onError() {},
  });
  cleanup();
  resolve({ items: [] });
  await settle();
  assert.equal(updates, 0);
});
