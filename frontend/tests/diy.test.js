import test from "node:test";
import assert from "node:assert/strict";
import {
  newPart,
  designBounds,
  designIssues,
  placedDesign,
  updatePlacedDesign,
  materialPresets,
} from "../src/diy/design.js";
import { chooseModel, selectableModel } from "../src/hooks/modelSelection.js";

test("DIY旋转尺寸、字段校验和独立户型副本", () => {
  const design = {
    name: "边桌",
    category: "furniture",
    parts: [
      { ...newPart(), width: 1.2, depth: 0.6, height: 0.75, rotation: 90 },
    ],
  };
  const dims = designBounds(design).dimensions;
  assert.ok(Math.abs(dims[0] - 0.6) < 1e-8);
  assert.ok(Math.abs(dims[1] - 1.2) < 1e-8);
  assert.deepEqual(designIssues(design), []);
  const placed = placedDesign(design, { x: 2, y: 3 }, "living");
  design.parts[0].color = "#ffffff";
  assert.notEqual(placed.diy.parts[0].color, design.parts[0].color);
  assert.equal(placed.kind, "custom");
  design.parts[0].width = 6;
  design.parts[0].depth = 6;
  design.parts[0].rotation = 45;
  assert.ok(designIssues(design).some((m) => m.includes("组合")));
  assert.throws(() => placedDesign(design, { x: 0, y: 0 }, "living"));
  design.parts[0].x = NaN;
  assert.ok(designIssues(design).some((m) => m.includes("范围")));
});

test("修改户型中 DIY 部件默认保留整体缩放和位置，允许明确使用原生尺寸", () => {
  const design = { name: "柜子", category: "furniture", parts: [newPart()] };
  const item = {
    ...placedDesign(design, { x: 3, y: 4 }, "living"),
    width: 2,
    depth: 1,
    height: 1.5,
    rotation: 90,
  };
  const changed = structuredClone(design);
  Object.assign(changed.parts[0], materialPresets[0]);
  delete changed.parts[0].name;
  changed.parts[0].name = "新柜门";
  changed.parts[0].width = 1.2;
  const kept = updatePlacedDesign(item, changed);
  assert.deepEqual(
    [kept.width, kept.depth, kept.height, kept.x, kept.y, kept.rotation],
    [2, 1, 1.5, 3, 4, 90],
  );
  const natural = updatePlacedDesign(item, changed, false);
  assert.equal(natural.width, 1.2);
  assert.notDeepEqual(kept.diy, item.diy);
  changed.parts[0].color = "#ffffff";
  assert.notEqual(kept.diy.parts[0].color, changed.parts[0].color);
  assert.deepEqual(designIssues(kept.diy), []);
});

test("DIY可选纯文本模型，户型识别仍要求图片能力", () => {
  const text = { id: "text", supports_image: false },
    image = { id: "image", supports_image: true };
  const catalog = { items: [text, image], default_model: "text" };
  assert.equal(selectableModel(text), false);
  assert.equal(selectableModel(text, false), true);
  assert.equal(chooseModel(catalog, "text", false), "text");
  assert.equal(chooseModel(catalog, "text"), "image");
});
