import test from "node:test";
import assert from "node:assert/strict";
import { createDraftReconnect } from "../src/hooks/draftReconnect.js";
import { createDraftSession } from "../src/hooks/draftSession.js";
import { restoreDraft } from "../src/hooks/restoreDraft.js";
import { toDraft, restorableDraft } from "../src/editor/geometry.js";
import { editorSaveStatus } from "../src/editor/saveStatus.js";
import { frameMetrics } from "../src/viewer/frameMetrics.js";

const document = () => ({
  layout: {
    outline: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ],
    rooms: [],
    walls: [],
    openings: [],
    lights: [],
  },
  furniture: { items: [], notes: [] },
});

test("断线恢复去重，读取期间的新编辑参与合并，旧项目晚到响应被丢弃", async () => {
  let resolve,
    calls = 0,
    merged;
  const base = document(),
    local = structuredClone(base),
    remote = structuredClone(base);
  const connection = createDraftReconnect(
    () => {
      calls++;
      return new Promise((r) => (resolve = r));
    },
    (r) => {
      merged = restoreDraft({ document: local, baseDocument: base }, r, base);
    },
  );
  const pending = connection.retry();
  connection.retry();
  await Promise.resolve();
  local.layout.title = "恢复期间输入的名称";
  resolve({ revision: 2, document: remote });
  await pending;
  assert.equal(calls, 1);
  assert.equal(merged.document.layout.title, local.layout.title);
  assert.equal(merged.conflict, false);
  let resolveOld,
    accepted = false;
  const old = createDraftReconnect(
    () => new Promise((r) => (resolveOld = r)),
    () => {
      accepted = true;
    },
  );
  const late = old.retry();
  await Promise.resolve();
  old.close();
  resolveOld({ revision: 5, document: remote });
  await late;
  assert.equal(accepted, false);
});
test("断线后的主动重连可恢复，恢复成功后不再重复读取", async () => {
  let attempts = 0,
    connected = 0;
  const c = createDraftReconnect(
    async () => {
      if (++attempts === 1) throw Error("offline");
      return { revision: 0, document: null };
    },
    () => connected++,
    100000,
  );
  await c.retry();
  await c.retry();
  await c.retry();
  assert.equal(attempts, 2);
  assert.equal(connected, 1);
  c.close();
});
test("草稿写入失败保留最新编辑，恢复后报告真实保存状态", async () => {
  let fail = true;
  const writes = [],
    reports = [];
  const s = createDraftSession(
    "edit:a",
    0,
    async (key, body) => {
      if (fail) throw Error("offline");
      writes.push(body.document);
      return { revision: 1, updated_at: new Date().toISOString() };
    },
    (v) => reports.push(v),
    100000,
  );
  s.schedule({ title: "旧" });
  await s.flush();
  assert.equal(reports.at(-1).phase, "offline");
  s.schedule({ title: "最新" });
  fail = false;
  await s.flush();
  assert.deepEqual(writes, [{ title: "最新" }]);
  assert.equal(reports.at(-1).phase, "saved");
  await s.close();
});
test("本地原始草稿可直接恢复且不共用可变引用", () => {
  const source = document();
  assert.ok(restorableDraft(source));
  const restored = toDraft(source);
  assert.deepEqual(restored, source);
  restored.layout.outline[0].x = 3;
  assert.equal(source.layout.outline[0].x, 0);
});
test("待保存、异常和AI预览不显示已保存；草稿与三维版本分开", () => {
  assert.equal(
    editorSaveStatus({ dirty: true, syncPhase: "saving" }).kind,
    "pending",
  );
  assert.equal(
    editorSaveStatus({ storageError: "空间不足", syncPhase: "saved" }).kind,
    "warning",
  );
  assert.equal(editorSaveStatus({}, true).kind, "preview");
  const saved = editorSaveStatus({ dirty: true, syncPhase: "saved" });
  assert.equal(saved.kind, "saved");
  assert.match(saved.text, /三维版本待更新/);
});
test("交互诊断记录超过250ms的卡顿，空闲间隔不计入", () => {
  const canvas = { dataset: {} };
  const m = frameMetrics(canvas, true);
  m.record(0, 10, true);
  m.record(500, 510, true);
  let data = JSON.parse(canvas.dataset.frameMetrics);
  assert.equal(data.longFrames, 1);
  assert.equal(data.worstFrameMs, 500);
  m.record(600, 610, false);
  m.record(9000, 9010, true);
  data = JSON.parse(canvas.dataset.frameMetrics);
  assert.equal(data.worstFrameMs, 500);
});
