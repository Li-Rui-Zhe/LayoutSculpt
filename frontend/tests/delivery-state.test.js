import test from "node:test";
import assert from "node:assert/strict";
import { deliveryState } from "../src/components/deliveryState.js";
import { toDraft } from "../src/editor/geometry.js";

const layout = {
  title: "户型",
  confidence: 1,
  scale_note: "米",
  warnings: [],
  outline: [],
  walls: [],
  rooms: [],
  openings: [],
  furniture: [],
};
test("导出比较包含未同步本地修改，不因编辑标识触发重建", () => {
  const original = toDraft(layout);
  const local = structuredClone(original);
  local.layout.edit_id = "selection";
  assert.equal(deliveryState({ document: local }, {}, layout).changed, false);
  local.layout.title = "修改后的标题";
  assert.equal(deliveryState({ document: local }, {}, layout).changed, true);
});
test("导出合并独立修改，同字段冲突不能被默默覆盖", () => {
  const original = toDraft(layout),
    local = structuredClone(original),
    remote = structuredClone(original);
  local.layout.title = "本地";
  remote.layout.scale_note = "已校准";
  const merged = deliveryState(
    { document: local, baseDocument: original },
    { document: remote },
    layout,
  );
  assert.equal(merged.conflict, false);
  assert.equal(merged.document.layout.title, "本地");
  assert.equal(merged.document.layout.scale_note, "已校准");
  remote.layout.title = "远端";
  assert.equal(
    deliveryState(
      { document: local, baseDocument: original },
      { document: remote },
      layout,
    ).conflict,
    true,
  );
});
