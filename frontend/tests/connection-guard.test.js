import test from "node:test";
import assert from "node:assert/strict";
import {
  checkConnection,
  guardedFetch,
  invalidateConnection,
} from "../src/connectionGuard.js";

const access = (allowed = true) => ({
  application: "layoutsculpt",
  protocol: 1,
  origin: "",
  write_allowed: allowed,
});
test.beforeEach(() => invalidateConnection());

test("并发和连续提交共享 15 秒检查，失败后失效且不自动重复写入", async (t) => {
  let checks = 0,
    writes = 0,
    fail = false;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.startsWith("/api/client-access")) {
      checks++;
      return Response.json(access());
    }
    writes++;
    return Response.json({}, { status: fail ? 403 : 200 });
  });
  await Promise.all(
    Array.from({ length: 10 }, () =>
      guardedFetch("/api/drafts/edit:a", { method: "POST" }),
    ),
  );
  assert.equal(checks, 1);
  assert.equal(writes, 10);
  fail = true;
  assert.equal(
    (await guardedFetch("/api/jobs", { method: "POST" })).status,
    403,
  );
  assert.equal(writes, 11);
  fail = false;
  await guardedFetch("/api/jobs", { method: "POST" });
  assert.equal(checks, 2);
  await checkConnection({ force: true });
  assert.equal(checks, 3);
});

test("取消某个预览不取消其他调用共用的检查；缓存到期会重新检测", async (t) => {
  let release,
    calls = 0,
    clock = 1000;
  t.mock.method(Date, "now", () => clock);
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1)
      await new Promise((resolve) => {
        release = resolve;
      });
    return Response.json(access());
  });
  const abort = new AbortController();
  const first = checkConnection({ signal: abort.signal });
  const second = checkConnection();
  abort.abort();
  await assert.rejects(first, { name: "AbortError" });
  release();
  await second;
  await checkConnection();
  assert.equal(calls, 1);
  clock += 15001;
  await checkConnection();
  assert.equal(calls, 2);
});

test("写入前确认服务与来源，失败时不发送业务数据，恢复后可重试", async (t) => {
  let allowed = false;
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.startsWith("/api/client-access"))
      return Response.json(access(allowed));
    sent.push({ url, body: options.body });
    return Response.json({ saved: true });
  });
  await assert.rejects(
    guardedFetch("/api/drafts/edit:a", {
      method: "POST",
      body: "private draft",
    }),
    { code: "origin" },
  );
  assert.equal(sent.length, 0);
  allowed = true;
  assert.deepEqual(
    await (
      await guardedFetch("/api/drafts/edit:a", {
        method: "POST",
        body: "private draft",
      })
    ).json(),
    { saved: true },
  );
  assert.equal(sent.length, 1);
});

test("错误服务、旧协议和错误来源回显不能通过写入预检", async (t) => {
  let payload;
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.startsWith("/api/client-access")) return Response.json(payload);
    writes++;
    return Response.json({});
  });
  for (payload of [
    { status: "ok" },
    { ...access(), application: "another-app" },
    { ...access(), protocol: 2 },
    { ...access(), origin: "http://other.invalid" },
  ]) {
    await assert.rejects(guardedFetch("/api/jobs", { method: "POST" }), {
      code: "service",
    });
  }
  assert.equal(writes, 0);
});

test("离线与非 JSON 服务返回可恢复错误；取消请求不继续写入", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("offline");
  });
  await assert.rejects(checkConnection(), { code: "unavailable", status: 503 });
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>another app</html>"),
  );
  await assert.rejects(checkConnection(), { code: "unavailable" });
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, "fetch", async (url, { signal }) => {
    signal.throwIfAborted();
  });
  await assert.rejects(
    guardedFetch("/api/jobs", { method: "POST", signal: controller.signal }),
    { name: "AbortError" },
  );
});
