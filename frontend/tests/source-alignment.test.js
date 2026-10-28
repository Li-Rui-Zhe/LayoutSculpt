import test from "node:test";
import assert from "node:assert/strict";
import { projectGroups } from "../src/projects.js";
import {
  generationDraftContent,
  hasGenerationDraft,
} from "../src/hooks/generationDraftContent.js";
import {
  sourcePixel,
  validSourceAlignment,
} from "../src/editor/sourceAlignment.js";

test("米制墙线按统一比例回到原图坐标，不按房间各自拉伸", () => {
  const frame = {
    image_width: 200,
    image_height: 150,
    origin_px: [20, 10],
    meters_per_pixel: 0.05,
  };
  assert.deepEqual(sourcePixel({ x: 8, y: 6 }, frame), { x: 180, y: 130 });
  assert.deepEqual(sourcePixel({ x: 0, y: 0 }, frame), { x: 20, y: 10 });
  for (const scale of [0, -1, Infinity, NaN])
    assert.equal(
      validSourceAlignment({ ...frame, meters_per_pixel: scale }),
      false,
    );
  assert.equal(sourcePixel({ x: NaN, y: 1 }, frame), null);
  assert.equal(
    validSourceAlignment({ ...frame, audit_outline: ["corrupt"] }),
    false,
  );
  assert.equal(validSourceAlignment({ ...frame, findings: [null] }), false);
});

test("识别方式可以恢复，重新识别保留在原方案的版本列表", () => {
  assert.equal(
    generationDraftContent({ recognitionMode: "fast" }).recognitionMode,
    "fast",
  );
  assert.equal(generationDraftContent({}).recognitionMode, "precise");
  assert.equal(hasGenerationDraft(generationDraftContent()), false);
  assert.equal(hasGenerationDraft({ recognitionMode: "fast" }), true);
  const groups = projectGroups([
    { id: "a", name: "原方案", created_at: "2026-10-28T00:00:00Z" },
    {
      id: "b",
      name: "重识别",
      created_at: "2026-10-28T00:01:00Z",
      reidentify_of: "a",
    },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].versions[1].projectId, "a");
});
