import test from "node:test";
import assert from "node:assert/strict";
import {
  editorPrimaryAction,
  editorReturnAction,
} from "../src/editor/saveStatus.js";

const state = { draft: { dirty: false }, name: "我的设计" };
test("返回预览接着更新修改，结构核对仍由用户确认", () => {
  assert.equal(editorReturnAction(state).preview, true);
  const dirty = { ...state, draft: { dirty: true } };
  assert.equal(editorReturnAction(dirty).preview, false);
  assert.equal(editorReturnAction(dirty).label, "更新并预览");
  assert.equal(editorReturnAction({ ...dirty, reviewing: true }).preview, true);
  assert.equal(
    editorReturnAction({ ...dirty, reviewing: true }).label,
    "返回结构核对",
  );
  for (const flag of [
    "busy",
    "drawing",
    "placement",
    "pendingDelete",
    "openingKind",
    "proposalPreview",
  ])
    assert.equal(editorReturnAction({ ...dirty, [flag]: true }).disabled, true);
  assert.equal(
    editorReturnAction({ ...dirty, issues: ["墙体异常"] }).disabled,
    true,
  );
});
test("未修改直接预览，修改后才生成；普通建议不阻断", () => {
  assert.equal(editorPrimaryAction(state).preview, true);
  assert.equal(
    editorPrimaryAction({ ...state, issues: ["旧方案问题"] }).disabled,
    false,
  );
  const changed = editorPrimaryAction({
    ...state,
    draft: { dirty: true },
    adviceCount: 5,
  });
  assert.equal(changed.preview, false);
  assert.equal(changed.disabled, false);
  assert.match(changed.label, /生成最新/);
});
test("放置、绘制、删除和建议预览不能被查看效果或生成按钮绕过", () => {
  for (const key of [
    "placement",
    "drawing",
    "pendingDelete",
    "openingKind",
    "proposalPreview",
  ])
    for (const dirty of [false, true]) {
      const action = editorPrimaryAction({
        ...state,
        draft: { dirty },
        [key]: true,
      });
      assert.equal(action.disabled, true);
      assert.match(action.detail, /请先/);
    }
  assert.equal(editorPrimaryAction({ ...state, busy: true }).disabled, true);
});
test("结构核对保持确认门禁，保存时给出缺失条件", () => {
  assert.equal(
    editorPrimaryAction({ ...state, reviewing: true }).disabled,
    true,
  );
  assert.equal(
    editorPrimaryAction({ ...state, reviewing: true, acknowledged: true })
      .preview,
    false,
  );
  assert.match(
    editorPrimaryAction({ ...state, draft: { dirty: true }, name: " " }).detail,
    /名称/,
  );
  assert.match(
    editorPrimaryAction({ ...state, draft: { dirty: true }, issues: ["错误"] })
      .detail,
    /布局/,
  );
});
