import test from "node:test";
import assert from "node:assert/strict";
import { previewKey, previewFeedback } from "../src/editor/previewIdentity.js";
import { createPreviewQueue } from "../src/editor/previewQueue.js";
import { createDraftSession } from "../src/hooks/draftSession.js";

test("后台同步与真实完成分别提示，旧模型已显示不代表最新修改已完成", () => {
  for (const phase of ["pending", "building", "downloading", "loading"])
    for (const fallback of [true, false]) {
      assert.match(
        previewFeedback(phase, true, fallback).label,
        /同步修改中|细节更新中/,
      );
      assert.equal(previewFeedback(phase, false, fallback).label, "加载中…");
      assert.notEqual(previewFeedback(phase, true, fallback).label, "已同步");
    }
  for (const hasContent of [true, false]) {
    assert.equal(previewFeedback("ready", hasContent).label, "已同步");
    assert.equal(previewFeedback("error", hasContent).label, "同步失败");
  }
});

test("锁定和对象标识不触发重复建模，隐藏、材质和尺寸修改仍须更新", () => {
  const doc = {
    layout: {
      walls: [{ id: "w1", height: 2.8, edit_id: "a", edit_locked: false }],
    },
  };
  const next = structuredClone(doc);
  next.layout.walls[0].edit_id = "b";
  next.layout.walls[0].edit_locked = true;
  assert.equal(previewKey(doc), previewKey(next));
  for (const patch of [
    { edit_hidden: true },
    { wall_material: "stone" },
    { height: 2.6 },
  ]) {
    const changed = structuredClone(doc);
    Object.assign(changed.layout.walls[0], patch);
    assert.notEqual(previewKey(doc), previewKey(changed));
  }
});

test("恢复已显示版本时取消旧生成，迟到结果不能重新打开加载状态", async () => {
  const states = [],
    published = [];
  let finish, report;
  const queue = createPreviewQueue({
    delay: 0,
    initialRevision: 8,
    report: (state) => states.push(state),
    publish: (value) => published.push(value),
    build: (_, signal, progress) => {
      report = progress;
      return new Promise((resolve) => (finish = resolve));
    },
  });
  queue.submit({ version: 2 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(states[0].revision, 9);
  queue.cancel();
  const count = states.length;
  report({ phase: "downloading" });
  finish("outdated");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(states.length, count);
  assert.equal(published.length, 0);
  queue.close();
});

test("未改动草稿读取完成后显示已同步；撤回待提交修改不会残留同步中", async () => {
  const states = [],
    writes = [];
  const base = { version: 1 };
  const session = createDraftSession(
    "edit:test",
    3,
    async (_, body) => {
      writes.push(body);
      return { revision: 4 };
    },
    (state) => states.push(state),
    100,
    { baseDocument: base },
  );
  session.schedule(base);
  assert.equal(states.at(-1).message, "草稿已同步本机");
  session.schedule({ version: 2 });
  assert.match(states.at(-1).message, /正在同步/);
  session.schedule(base);
  assert.equal(states.at(-1).message, "草稿已同步本机");
  await session.flush();
  await session.close();
  assert.equal(writes.length, 0);
});
