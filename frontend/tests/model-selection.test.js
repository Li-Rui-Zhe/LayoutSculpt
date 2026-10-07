import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseModel,
  selectableModel,
  generationError,
} from "../src/hooks/modelSelection.js";

test("stale saved model and unusable default fall back to an image model", () => {
  const catalog = {
    default_model: "blocked",
    items: [
      { id: "text", supports_image: false },
      { id: "blocked", available: false },
      { id: "vision", supports_image: true },
    ],
  };
  assert.equal(chooseModel(catalog, "blocked"), "vision");
  assert.equal(chooseModel(catalog, "gone"), "vision");
  assert.equal(selectableModel(catalog.items[0]), false);
  assert.equal(chooseModel({ items: [] }, "gone"), "");
});

test("selectable local provider and saved preference are preserved", () => {
  const catalog = {
    default_model: "vision",
    items: [
      { id: "vision", supports_image: true },
      { id: "custom", supports_image: null },
    ],
  };
  assert.equal(chooseModel(catalog, "custom"), "custom");
});

test("legacy stored unsupported-model errors show a useful explanation", () => {
  const raw = String.raw`{'message': '{"detail":"The \'gpt-6.1-sol\' model is not supported when using Codex with a ChatGPT account."}'}`;
  assert.match(generationError(raw), /不支持模型「gpt-6.1-sol」/);
  assert.equal(generationError("正常记录"), "正常记录");
});
