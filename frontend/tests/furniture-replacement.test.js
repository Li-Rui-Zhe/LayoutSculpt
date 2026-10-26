import test from "node:test";
import assert from "node:assert/strict";
import {
  replaceFurniture,
  replacementCandidates,
} from "../src/library/replacement.js";

const snapshot = (char) => `snapshot:${char.repeat(64)}`;
function document() {
  return {
    layout: {
      outline: [],
      rooms: [
        {
          id: "r",
          polygon: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 5, y: 4 },
            { x: 0, y: 4 },
          ],
        },
      ],
      walls: [],
      openings: [],
    },
    furniture: {
      items: [
        {
          kind: "sofa",
          name: "客厅沙发",
          x: 2.5,
          y: 2,
          room_id: "r",
          rotation: 90,
          width: 2,
          depth: 0.8,
          height: 0.8,
          elevation: 0.1,
          edit_id: "keep",
          edit_group: "living",
          asset_id: snapshot("a"),
          source_asset_id: `file:${"a".repeat(24)}`,
          asset_family: "沙发",
        },
      ],
      notes: [],
    },
  };
}
const template = {
  kind: "sofa",
  name: "圆润双人款",
  width: 1.8,
  depth: 0.85,
  height: 0.82,
  elevation: 0,
  asset_id: snapshot("b"),
  source_asset_id: `file:${"b".repeat(24)}`,
  asset_family: "沙发",
  diy: null,
};

test("换款保留对象身份、位置朝向和离地高度，使用原始尺寸且不修改原稿", () => {
  const original = document(),
    before = structuredClone(original);
  const next = replaceFurniture(original, 0, template),
    item = next.furniture.items[0];
  assert.deepEqual(original, before);
  for (const key of [
    "x",
    "y",
    "room_id",
    "rotation",
    "elevation",
    "edit_id",
    "edit_group",
    "name",
  ])
    assert.equal(item[key], original.furniture.items[0][key]);
  assert.equal(item.asset_id, snapshot("b"));
  assert.deepEqual([item.width, item.depth, item.height], [1.8, 0.85, 0.82]);
  assert.equal(next.furniture.items.length, 1);
});

test("换款拒绝越界、碰撞和锁定，90 件上限不阻止原位替换", () => {
  const doc = document();
  assert.throws(
    () => replaceFurniture(doc, 0, { ...template, width: 6 }),
    /边界/,
  );
  doc.furniture.items.push({
    ...template,
    x: 2.5,
    y: 2,
    room_id: "r",
    rotation: 0,
  });
  assert.throws(() => replaceFurniture(doc, 0, template), /重叠/);
  doc.furniture.items = [doc.furniture.items[0]];
  doc.furniture.items[0].edit_locked = true;
  assert.throws(() => replaceFurniture(doc, 0, template), /解锁/);
  doc.furniture.items[0].edit_locked = false;
  doc.furniture.items.push(
    ...Array.from({ length: 89 }, () => ({
      kind: "rug",
      room_id: "r",
      x: 1,
      y: 1,
      width: 0.1,
      depth: 0.1,
      height: 0.02,
      rotation: 0,
    })),
  );
  assert.equal(replaceFurniture(doc, 0, template).furniture.items.length, 90);
});

test("候选按品类而非 model 通用类型聚合，隐藏归档款并兼容历史家具", () => {
  const items = [
    {
      id: "computer",
      name: "台式电脑",
      family: "电脑",
      furniture_kind: "model",
      placeable: true,
    },
    {
      id: "laptop",
      name: "笔记本电脑",
      family: "电脑",
      furniture_kind: "model",
      placeable: true,
    },
    {
      id: "rack",
      name: "晾衣架",
      family: "晾衣架",
      furniture_kind: "model",
      placeable: true,
    },
  ];
  assert.deepEqual(
    replacementCandidates(items, { kind: "model", asset_family: "电脑" }).map(
      (i) => i.id,
    ),
    ["computer", "laptop"],
  );
  assert.deepEqual(
    replacementCandidates(items, { kind: "model", name: "书房电脑" }, [
      "laptop",
    ]).map((i) => i.id),
    ["computer"],
  );
});
