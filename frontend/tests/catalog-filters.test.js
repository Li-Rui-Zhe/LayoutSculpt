import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesCatalog,
  catalogFacets,
  dimensionLabel,
} from "../src/library/catalogFilters.js";
const items = [
  {
    id: "left",
    name: "云屿左贵妃转角沙发",
    source: "builtin",
    category: "客厅",
    family: "沙发",
    variant: "左贵妃",
    style: "原木自然",
    dimensions: [2.85, 1.65, 0.88],
    rooms: ["客厅"],
    tags: ["沙发", "左贵妃"],
  },
  {
    id: "small",
    name: "奶油双人沙发",
    source: "builtin",
    category: "客厅",
    family: "沙发",
    variant: "双人",
    style: "奶油简约",
    dimensions: [1.65, 0.86, 0.82],
  },
  {
    id: "bed",
    name: "儿童床",
    source: "builtin",
    category: "儿童房",
    rooms: ["儿童房", "卧室"],
    family: "床",
    style: "原木自然",
    dimensions: [1.05, 1.9, 0.82],
  },
  { id: "diy", name: "我的柜子", source: "diy" },
];
test("空间、品类、风格、尺寸和多关键词可组合筛选", () => {
  assert.deepEqual(
    items
      .filter((i) =>
        matchesCatalog(i, {
          source: "builtin",
          family: "沙发",
          query: "沙发 左贵妃",
        }),
      )
      .map((i) => i.id),
    ["left"],
  );
  assert.deepEqual(
    items
      .filter((i) => matchesCatalog(i, { family: "沙发", maxWidth: "1.8" }))
      .map((i) => i.id),
    ["small"],
  );
  assert.deepEqual(
    items
      .filter((i) => matchesCatalog(i, { category: "卧室" }))
      .map((i) => i.id),
    ["bed"],
  );
  assert.deepEqual(
    items
      .filter((i) => matchesCatalog(i, { style: "奶油简约" }))
      .map((i) => i.id),
    ["small"],
  );
  assert.equal(matchesCatalog(items[3], { query: "我的" }), true);
  assert.equal(matchesCatalog(items[3], { maxWidth: "2" }), false);
});
test("分类随来源与空间联动，导入和 DIY 无分类也能正常浏览", () => {
  assert.deepEqual(catalogFacets(items, "builtin", "客厅").families, ["沙发"]);
  assert.deepEqual(catalogFacets(items, "builtin").rooms, [
    "客厅",
    "卧室",
    "儿童房",
  ]);
  assert.deepEqual(catalogFacets(items, "diy").families, []);
  assert.equal(dimensionLabel(items[0]), "285 × 165 × 88 cm");
  assert.equal(dimensionLabel(items[3]), "尺寸待读取");
});
