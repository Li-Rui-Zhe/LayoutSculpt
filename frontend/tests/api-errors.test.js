import test from "node:test";
import assert from "node:assert/strict";
import { apiErrorMessage } from "../src/apiErrors.js";
import { api } from "../src/api.js";

const legacyError =
  "1 validation error for JobOptions style Input should be 'natural', 'cream' or 'modern' [type=literal_error, input_value='custom', input_type=str] For further information visit https://errors.pydantic.dev/2.13/v/literal_error";

test("旧后端自定义风格错误说明重启方法，不泄漏校验堆栈", () => {
  const message = apiErrorMessage(legacyError, 422);
  assert.match(message, /重启本项目前后端/);
  assert.match(message, /仍保留/);
  assert.doesNotMatch(message, /pydantic|JobOptions|literal_error/);
});

test("中文业务错误保留，结构化英文校验错误和缺失字段安全降级", () => {
  assert.equal(
    apiErrorMessage("请填写自定义空间风格", 422),
    "请填写自定义空间风格",
  );
  assert.equal(
    apiErrorMessage([{ msg: "Value error, 请填写自定义空间风格" }], 422),
    "请填写自定义空间风格",
  );
  for (const detail of [
    [{ msg: "Input should be a valid string" }],
    [null],
    [],
    null,
  ]) {
    assert.match(apiErrorMessage(detail, 422), /[\u4e00-\u9fff]/);
  }
});

test("接口请求保留错误状态码和中文提示，不把失败当成功", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    url.startsWith("/api/client-access")
      ? Response.json({
          application: "layoutsculpt",
          protocol: 1,
          origin: "",
          write_allowed: true,
        })
      : new Response(JSON.stringify({ detail: legacyError }), { status: 422 }),
  );
  await assert.rejects(api("/jobs", { method: "POST" }), (error) => {
    assert.equal(error.status, 422);
    assert.match(error.message, /重启本项目前后端/);
    return true;
  });
});
