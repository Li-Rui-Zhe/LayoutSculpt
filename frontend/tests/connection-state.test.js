import test from "node:test";
import assert from "node:assert/strict";
import {
  savedModelId,
  readableModelId,
  hasConnectionChanges,
} from "../src/settings/connectionState.js";

const settings = {
  default_provider: "deepseek",
  deepseek: { default_model: "example-flash", configured: true },
  codex: { default_model: "local-choice" },
};

test("saved model IDs are restored with their provider identity", () => {
  assert.equal(savedModelId(settings, "deepseek"), "deepseek::example-flash");
  assert.equal(savedModelId(settings, "codex"), "local-choice");
  assert.equal(
    savedModelId(
      { deepseek: { default_model: "deepseek::example-pro" } },
      "deepseek",
    ),
    "deepseek::example-pro",
  );
  assert.equal(savedModelId(null, "codex"), "");
  assert.equal(readableModelId("deepseek::example-pro"), "example-pro");
});

test("pending choices remain distinct from the persisted model and provider", () => {
  assert.equal(
    hasConnectionChanges(settings, "deepseek", "deepseek::example-flash"),
    false,
  );
  assert.equal(
    hasConnectionChanges(settings, "deepseek", "deepseek::example-pro"),
    true,
  );
  assert.equal(hasConnectionChanges(settings, "codex", "local-choice"), true);
  assert.equal(hasConnectionChanges(settings, "deepseek", ""), true);
  assert.equal(settings.deepseek.default_model, "example-flash");
});

test("blank input keeps a saved key while a replacement requires saving", () => {
  assert.equal(
    hasConnectionChanges(
      settings,
      "deepseek",
      "deepseek::example-flash",
      "   ",
    ),
    false,
  );
  assert.equal(
    hasConnectionChanges(
      settings,
      "deepseek",
      "deepseek::example-flash",
      "not-a-real-credential",
    ),
    true,
  );
});
