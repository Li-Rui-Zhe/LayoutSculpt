import test from "node:test";
import assert from "node:assert/strict";
import {
  preparePreviewDocument,
  applyOpeningHeightFix,
} from "../src/editor/previewDocument.js";
import { problems } from "../src/editor/geometry.js";

const fixture = () => ({
  layout: {
    outline: [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 4 },
      { x: 0, y: 4 },
    ],
    rooms: [],
    lights: [],
    walls: [
      {
        id: "w19",
        start: { x: 0, y: 0 },
        end: { x: 5, y: 0 },
        height: 1.95,
        thickness: 0.2,
        exterior: true,
      },
    ],
    openings: [
      {
        edit_id: "window-17",
        wall_id: "w19",
        kind: "window",
        offset: 1,
        width: 1.2,
        bottom: 0.9,
        height: 3,
      },
    ],
  },
  furniture: { items: [], notes: [] },
});

test("阳台低墙同样裁切超高开口，原始尺寸与实际墙高保持不变", () => {
  const original = fixture();
  original.layout.walls[0].height = 1.1;
  const preview = preparePreviewDocument(original);
  assert.equal(preview.adjustments.length, 1);
  const opening = preview.document.layout.openings[0];
  assert.ok(Math.abs(opening.bottom + opening.height - 1.1) < 1e-8);
  assert.equal(original.layout.openings[0].height, 3);
  assert.equal(preview.document.layout.walls[0].height, 1.1);
  assert.ok(!problems(preview.document).some((p) => p.type === "openings"));
});

test("超高窗户只在预览副本中裁切；原稿仍被保存校验拦截", () => {
  const original = fixture(),
    before = structuredClone(original);
  const preview = preparePreviewDocument(original);
  assert.deepEqual(original, before);
  assert.equal(preview.document.layout.openings[0].bottom, 0.9);
  assert.ok(Math.abs(preview.document.layout.openings[0].height - 1.05) < 1e-8);
  assert.equal(preview.document.layout.openings[0].edit_id, "window-17");
  assert.equal(preview.document.furniture, original.furniture);
  assert.equal(preview.document.layout.walls, original.layout.walls);
  assert.equal(preview.adjustments[0].wallId, "w19");
  assert.ok(problems(original).some((p) => p.type === "openings"));
  assert.ok(!problems(preview.document).some((p) => p.type === "openings"));
});

test("显式修正只改变指定门窗，旧快照可用于撤销", () => {
  const original = fixture();
  original.layout.openings.push({
    ...original.layout.openings[0],
    edit_id: "other",
    offset: 3,
  });
  const next = applyOpeningHeightFix(original, 0);
  assert.equal(original.layout.openings[0].height, 3);
  assert.equal(next.layout.openings[1], original.layout.openings[1]);
  assert.equal(preparePreviewDocument(next).adjustments.length, 1);
  assert.equal(preparePreviewDocument(original).adjustments.length, 2);
});

test("锁定窗户可在预览中显示，但不能通过修正按钮绕过锁定", () => {
  const original = fixture();
  original.layout.openings[0].edit_locked = true;
  assert.equal(preparePreviewDocument(original).adjustments[0].locked, true);
  assert.throws(() => applyOpeningHeightFix(original, 0), /锁定/);
});

test("窗台超过墙顶时仍生成有效预览；缺失墙引用和非法数值不擅自修复", () => {
  const original = fixture();
  original.layout.openings[0].bottom = 2.5;
  const adjusted = preparePreviewDocument(original).document.layout.openings[0];
  assert.ok(adjusted.height > 0);
  assert.ok(adjusted.bottom + adjusted.height <= 1.95 + 1e-6);
  original.layout.openings[0].wall_id = "missing";
  assert.equal(preparePreviewDocument(original).document, original);
  original.layout.openings[0].wall_id = "w19";
  original.layout.openings[0].height = NaN;
  assert.equal(preparePreviewDocument(original).document, original);
});

test("正常门窗不改变引用和尺寸，门与通道修正后仍从地面开始", () => {
  for (const kind of ["door", "passage"]) {
    const original = fixture();
    Object.assign(original.layout.openings[0], { kind, bottom: 0 });
    const next = applyOpeningHeightFix(original, 0);
    assert.equal(next.layout.openings[0].bottom, 0);
    assert.equal(next.layout.openings[0].height, 1.95);
    assert.equal(preparePreviewDocument(next).document, next);
  }
});
