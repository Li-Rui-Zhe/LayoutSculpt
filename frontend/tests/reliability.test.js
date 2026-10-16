import test from "node:test";
import assert from "node:assert/strict";
import { createDraftSession } from "../src/hooks/draftSession.js";
import { restoreDraft } from "../src/hooks/restoreDraft.js";
import {
  operationKey,
  finishOperation,
  formSignature,
} from "../src/hooks/operationKeys.js";

test("提交失败刷新后沿用请求标识，成功后再次提交创建新操作", async () => {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  const key = operationKey("reliability-test", "same");
  const reloaded = await import("../src/hooks/operationKeys.js?restored");
  assert.equal(reloaded.operationKey("reliability-test", "same"), key);
  finishOperation("reliability-test");
  assert.notEqual(operationKey("reliability-test", "same"), key);
  finishOperation("reliability-test");
  delete globalThis.sessionStorage;
});

test("同名同大小图片内容改变时提交指纹也改变", async () => {
  const a = new FormData(),
    b = new FormData();
  a.append("file", new Blob(["aa"], { type: "image/png" }), "same.png");
  b.append("file", new Blob(["bb"], { type: "image/png" }), "same.png");
  assert.notEqual(await formSignature(a), await formSignature(b));
  assert.equal(await formSignature(a), await formSignature(a));
});

test("生成表单慢写入不能越过提交后的草稿清理", async () => {
  let value;
  let count = 0;
  globalThis.indexedDB = {
    open() {
      const opening = {};
      setTimeout(
        () => {
          opening.result = {
            close() {},
            transaction() {
              const tx = {
                objectStore() {
                  return {
                    put(v) {
                      value = v;
                      return { result: "current" };
                    },
                    delete() {
                      value = undefined;
                      return {};
                    },
                    get() {
                      return { result: value };
                    },
                  };
                },
              };
              setTimeout(() => tx.oncomplete(), 1);
              return tx;
            },
          };
          opening.onsuccess();
        },
        ++count === 1 ? 30 : 1,
      );
      return opening;
    },
  };
  try {
    const { saveGenerationDraft, clearGenerationDraft, readGenerationDraft } =
      await import("../src/hooks/generationDraft.js");
    await Promise.all([
      saveGenerationDraft({ name: "旧草稿" }),
      clearGenerationDraft(),
    ]);
    assert.equal(await readGenerationDraft(), undefined);
  } finally {
    delete globalThis.indexedDB;
  }
});

test("临时断网不丢待写草稿，恢复后只同步最新修改", async () => {
  const writes = [];
  const session = createDraftSession(
    "edit:a",
    3,
    async (_, body) => {
      writes.push(body);
      if (writes.length === 1) throw new Error("offline");
      return { revision: 4, updated_at: new Date().toISOString() };
    },
    () => {},
    10000,
  );
  session.schedule({ x: 1 });
  await session.flush();
  session.schedule({ x: 2 });
  await session.flush();
  await session.close();
  assert.deepEqual(
    writes.map((w) => w.document.x),
    [1, 2],
  );
  assert.equal(writes[1].revision, 3);
});

test("恢复优先合并离线修改，同字段冲突保留本地而非静默覆盖", () => {
  const local = { document: { x: 2, y: 1 }, baseDocument: { x: 1, y: 1 } };
  assert.deepEqual(restoreDraft(local, { document: { x: 1, y: 3 } }, {}), {
    document: { x: 2, y: 3 },
    conflict: false,
  });
  assert.deepEqual(restoreDraft(local, { document: { x: 4, y: 1 } }, {}), {
    document: local.document,
    conflict: true,
  });
  assert.equal(
    restoreDraft({ document: { x: 2 } }, { document: { x: 1 } }, {}).conflict,
    true,
  );
});
