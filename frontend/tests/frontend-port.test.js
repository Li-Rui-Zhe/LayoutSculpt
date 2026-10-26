import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFrontendPort,
  frontendPortGuard,
} from "../../scripts/frontend-port.mjs";

test("前端与预览拒绝单独覆盖端口，构建不受影响", () => {
  assert.doesNotThrow(() => assertFrontendPort(5176, 5176));
  assert.throws(() => assertFrontendPort(5177, 5176), /STUDIO_FRONTEND_PORT/);
  assert.throws(
    () =>
      frontendPortGuard.configResolved({
        command: "serve",
        server: { port: 8000 },
      }),
    /不一致/,
  );
  assert.throws(
    () =>
      frontendPortGuard.configResolved({
        command: "serve",
        isPreview: true,
        preview: { port: 8000 },
      }),
    /不一致/,
  );
  assert.doesNotThrow(() =>
    frontendPortGuard.configResolved({ command: "build" }),
  );
});
