import test from "node:test";
import assert from "node:assert/strict";
import {
  manualDesignChecks,
  feedbackKey,
} from "../src/editor/manualValidation.js";
import { showerPlacementIssues } from "../src/editor/showerPlacement.js";

function document() {
  const corners = [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 3 },
    { x: 0, y: 3 },
  ];
  return {
    layout: {
      outline: corners,
      rooms: [{ id: "bath", name: "卫生间", polygon: corners }],
      walls: corners.map((start, i) => ({
        id: `w${i}`,
        start,
        end: corners[(i + 1) % 4],
        thickness: 0.12,
        height: 2.7,
      })),
      openings: [],
      lights: [],
    },
    furniture: {
      items: [
        {
          kind: "shower",
          name: "淋浴间",
          room_id: "bath",
          x: 2.3,
          y: 0.7,
          width: 1,
          depth: 1,
          height: 2.1,
          rotation: 0,
          elevation: 0,
        },
        {
          kind: "toilet",
          name: "坐便器",
          room_id: "bath",
          x: 2.65,
          y: 1.6,
          width: 0.4,
          depth: 0.6,
          height: 0.76,
          rotation: 0,
          elevation: 0,
        },
      ],
    },
  };
}

test("入口预留区碰到相邻洁具时，人工设计保留提示但不阻止保存", () => {
  const doc = document();
  const original = JSON.stringify(doc);
  const result = manualDesignChecks(doc);
  assert.deepEqual(result.errors, []);
  assert.ok(
    result.warnings.some(
      (issue) =>
        issue.text.includes("入口受阻") && issue.severity === "warning",
    ),
  );
  assert.equal(JSON.stringify(doc), original, "检查不能移动或修改用户家具");
  assert.ok(
    showerPlacementIssues(doc.furniture.items[0], doc).some((text) =>
      text.includes("入口受阻"),
    ),
    "自动摆放仍使用原有严格入口检查",
  );
});
test("基础边界错误仍然阻止保存，即使同时存在通行建议", () => {
  const doc = document();
  doc.furniture.items[1].x = 3.2;
  const result = manualDesignChecks(doc);
  assert.ok(result.errors.some((issue) => issue.text.includes("超出所属房间")));
  doc.furniture.items[1].x = 2.65;
  doc.furniture.items[1].elevation = -0.1;
  assert.ok(
    manualDesignChecks(doc).errors.some((issue) =>
      issue.text.includes("离地高度"),
    ),
  );
});
test("轮廓推导失败和空间重叠仍为阻塞问题", () => {
  const doc = document();
  const issue = { type: "outline", index: 0, text: "轮廓无法闭合" };
  assert.ok(manualDesignChecks(doc, issue).errors.includes(issue));
  doc.layout.rooms.push({
    ...doc.layout.rooms[0],
    id: "other",
    name: "另一个空间",
  });
  assert.ok(
    manualDesignChecks(doc).errors.some((issue) => issue.text.includes("重叠")),
  );
});
test("淋浴尺寸等体验提示仍可定位，不删除基础数据约束", () => {
  const doc = document();
  doc.furniture.items[0].width = 0.75;
  const result = manualDesignChecks(doc);
  assert.ok(
    result.warnings.some(
      (issue) =>
        issue.text.includes("过小") &&
        issue.type === "furniture" &&
        issue.index === 0,
    ),
  );
  assert.deepEqual(result.errors, []);
});
test("前后端建议仅标点不同时去重，保留内容不同的建议", () => {
  assert.equal(feedbackKey("入口受阻。 "), feedbackKey("入口受阻"));
  assert.notEqual(feedbackKey("入口受阻"), feedbackKey("遮挡窗户"));
  assert.deepEqual(manualDesignChecks(null), { errors: [], warnings: [] });
});
