import test from "node:test";
import assert from "node:assert/strict";
import { findPython } from "../../scripts/python.mjs";

test("macOS launcher uses python3 without requiring a python alias", () => {
  const calls = [];
  assert.equal(
    findPython("project", {
      platform: "darwin",
      exists: () => false,
      probe: (command) => {
        calls.push(command);
        return { status: 0 };
      },
    }),
    "python3",
  );
  assert.deepEqual(calls, ["python3"]);
});
test("project virtual environment takes priority", () => {
  const selected = findPython("project", {
    platform: "darwin",
    exists: () => true,
    probe: () => {
      throw new Error("must not probe system Python");
    },
  });
  assert.match(selected.replaceAll("\\", "/"), /project\/\.venv\/bin\/python$/);
});
test("unsupported Python versions produce a setup instruction", () => {
  assert.throws(
    () =>
      findPython("project", {
        platform: "win32",
        exists: () => false,
        probe: () => ({ status: 1 }),
      }),
    /Python 3.11/,
  );
});
