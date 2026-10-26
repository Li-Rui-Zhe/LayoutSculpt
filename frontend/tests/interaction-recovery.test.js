import test from "node:test";
import assert from "node:assert/strict";
import { readContext, writeContext } from "../src/hooks/urlContext.js";
import { readArtwork, writeArtwork } from "../src/diy/paintTools.js";

test("最近更新排序可以写入并从 URL 恢复，无效值回退", () => {
  const originalLocation = globalThis.location,
    originalHistory = globalThis.history;
  globalThis.location = {
    href: "http://127.0.0.1:5173/?project=sample#library",
  };
  globalThis.history = {
    replaceState(_data, _title, url) {
      globalThis.location.href = String(url);
    },
  };
  try {
    writeContext({ librarySort: "recent", materialCategory: "floor" });
    assert.equal(readContext("librarySort", "source"), "recent");
    assert.equal(readContext("materialCategory"), "floor");
    assert.equal(new URL(location.href).hash, "#library");
    writeContext({ librarySort: "invalid" });
    assert.equal(readContext("librarySort", "source"), "source");
  } finally {
    globalThis.location = originalLocation;
    globalThis.history = originalHistory;
  }
});

test("IndexedDB 被其他页面阻塞时明确拒绝，迟到的连接也会关闭", async () => {
  const original = globalThis.indexedDB;
  let request,
    closed = 0;
  globalThis.indexedDB = {
    open() {
      request = {};
      queueMicrotask(() => request.onblocked());
      return request;
    },
  };
  try {
    await assert.rejects(readArtwork("walls"), /其他页面占用/);
    request.result = {
      close() {
        closed++;
      },
    };
    request.onsuccess();
    assert.equal(closed, 1);
  } finally {
    globalThis.indexedDB = original;
  }
});

test("手绘事务被取消时结束等待并释放连接，不把失败当成空白草稿", async () => {
  const original = globalThis.indexedDB;
  let closed = 0;
  globalThis.indexedDB = {
    open() {
      const request = {
        result: {
          close() {
            closed++;
          },
          transaction() {
            const tx = {
              objectStore() {
                return {
                  get() {
                    return {};
                  },
                  put() {
                    return {};
                  },
                };
              },
            };
            queueMicrotask(() => tx.onabort());
            return tx;
          },
        },
      };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  };
  try {
    await assert.rejects(readArtwork("floor"), /读取被中断/);
    await assert.rejects(writeArtwork("floor", { image: "old" }), /保存被中断/);
    assert.equal(closed, 2);
  } finally {
    globalThis.indexedDB = original;
  }
});
