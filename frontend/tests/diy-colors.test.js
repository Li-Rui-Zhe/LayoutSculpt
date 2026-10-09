import test from "node:test";
import assert from "node:assert/strict";
import { newPart } from "../src/diy/design.js";
import {
  normalizeColor,
  colorTargets,
  recolorParts,
  commitDesign,
} from "../src/diy/colors.js";

const design = () => ({
  name: "双色柜",
  parts: [
    { ...newPart(), id: "door", color: "#AABBCC" },
    { ...newPart(), id: "frame", color: "#aabbcc" },
    { ...newPart(), id: "handle", color: "#303432", metallic: 0.9 },
  ],
});

test("色号支持简写和大小写，拒绝不合法颜色", () => {
  assert.equal(normalizeColor(" ABC "), "#aabbcc");
  assert.equal(normalizeColor("#315E49"), "#315e49");
  for (const value of ["", "red", "#12345", "#12345678", "##abc", null])
    assert.equal(normalizeColor(value), null);
});

test("换色范围隔离且保留几何与材质；连续换色固定原目标", () => {
  const original = design();
  const snapshot = structuredClone(original);
  assert.deepEqual(colorTargets(original, "door", "selected"), ["door"]);
  const ids = colorTargets(original, "door", "matching");
  assert.deepEqual(ids, ["door", "frame"]);
  const first = recolorParts(original, ids, "#303432");
  const second = recolorParts(first, ids, "#fff");
  assert.equal(second.parts[2].color, "#303432");
  for (let i = 0; i < 2; i++)
    assert.deepEqual(second.parts[i], {
      ...original.parts[i],
      color: "#ffffff",
    });
  assert.deepEqual(original, snapshot);
  const all = recolorParts(
    original,
    colorTargets(original, "door", "all"),
    "#315e49",
  );
  assert.ok(all.parts.every((p) => p.color === "#315e49"));
  assert.equal(all.parts[2].metallic, 0.9);
  assert.deepEqual(colorTargets(original, "missing", "matching"), []);
  assert.equal(recolorParts(original, ids, "invalid"), original);
});

test("拖动颜色只占一次撤销记录，下一次操作独立，撤销后可重新编辑", () => {
  const initial = design();
  let h = { past: [], present: initial, future: [] };
  for (const color of ["#123456", "#abcdef", "#ffffff"])
    h = commitDesign(h, recolorParts(h.present, ["door"], color), "gesture-1");
  assert.deepEqual(h.past, [initial]);
  assert.equal(h.present.parts[0].color, "#ffffff");
  h = commitDesign(h, recolorParts(h.present, ["frame"], "#315e49"));
  assert.equal(h.past.length, 2);
  const undone = {
    past: h.past.slice(0, -1),
    present: h.past.at(-1),
    future: [h.present],
  };
  const edited = commitDesign(
    undone,
    recolorParts(undone.present, ["handle"], "#eee5d4"),
    "gesture-2",
  );
  assert.equal(edited.past.length, 2);
  assert.deepEqual(edited.future, []);
});
