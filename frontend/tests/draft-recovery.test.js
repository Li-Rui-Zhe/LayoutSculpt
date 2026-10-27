import test from "node:test";
import assert from "node:assert/strict";
import {
  generationDraftContent,
  hasGenerationDraft,
} from "../src/hooks/generationDraftContent.js";
import { draftRecoveryAction } from "../src/diy/draftRecovery.js";

test("空白或纯空格不产生草稿，图片和非默认选项需要保留", () => {
  assert.equal(hasGenerationDraft({}), false);
  assert.equal(hasGenerationDraft({ name: "  ", notes: "\n" }), false);
  for (const value of [
    { file: new Blob(["image"]) },
    { notes: "保留承重墙" },
    { style: "custom" },
    { finishes: { floor: "wood" } },
    { manualReview: true },
    { collaboration: false },
    { furnitureMode: "ai" },
  ])
    assert.equal(hasGenerationDraft(value), true);
  assert.equal(hasGenerationDraft({ file: {} }), false);
});

test("恢复生成草稿保留图片、材质及关闭的设置，缺失字段使用默认值", () => {
  const file = new Blob(["image"]);
  const value = generationDraftContent({
    file,
    collaboration: false,
    finishes: { walls: "stone" },
  });
  assert.equal(value.file, file);
  assert.equal(value.collaboration, false);
  assert.deepEqual(value.finishes, { walls: "stone", floor: "" });
  assert.equal(value.style, "natural");
  assert.equal(hasGenerationDraft(generationDraftContent()), false);
});

const saved = { name: "椅子", parts: [{ id: "a", width: 1 }] };
const changed = { ...saved, name: "新椅子" };
test("服务端字段排序不同不应导致草稿差异提示", () => {
  assert.equal(
    draftRecoveryAction(saved, {
      parts: [{ width: 1, id: "a" }],
      name: "椅子",
    }),
    "none",
  );
});
test("空页面或尚未编辑的素材自动续接草稿", () => {
  assert.equal(draftRecoveryAction(null, saved), "restore");
  assert.equal(draftRecoveryAction(saved, changed, true, saved), "restore");
  assert.equal(draftRecoveryAction(saved, null), "none");
});
test("迟到的草稿不得覆盖已修改的设计、未提交输入或主动切换后的内容", () => {
  assert.equal(draftRecoveryAction(changed, saved, true, saved), "choose");
  assert.equal(draftRecoveryAction(saved, changed, false, saved), "choose");
  assert.equal(draftRecoveryAction(null, saved, false), "choose");
});
