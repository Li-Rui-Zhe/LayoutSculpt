import test from "node:test";
import assert from "node:assert/strict";
import {
  restoreSurfaces,
  sourceRecipe,
  surfaceSaveReason,
} from "../src/diy/surfaceWorkspace.js";

const bases = [
  { id: "floor-oak", name: "原木直铺", color: "#ddccaa", roughness: 0.8 },
];
const ready = {
  hasSource: true,
  mode: "ai",
  paintStatus: "pending",
  previewBusy: false,
  previewError: "",
  name: "大理石地砖",
  busy: false,
};

test("未同步的画布不再锁住 AI、样板或上传素材的保存", () => {
  for (const mode of ["ai", "preset", "upload"])
    assert.equal(surfaceSaveReason({ ...ready, mode }), "");
  assert.equal(surfaceSaveReason({ ...ready, mode: "draw" }), "正在同步画布…");
  assert.equal(
    surfaceSaveReason({ ...ready, mode: "draw", paintStatus: "ready" }),
    "",
  );
});

test("没有 AI 结果时明确提示先生成，不把上次手绘内容当成 AI 结果保存", () => {
  assert.equal(
    surfaceSaveReason({ ...ready, hasSource: false }),
    "生成材质后即可保存",
  );
  assert.equal(
    surfaceSaveReason({ ...ready, previewError: "网络异常" }),
    "预览失败，请重试",
  );
});

test("旧版手绘草稿迁移后默认可进入 AI，四种创作方式各自独立", () => {
  const old = {
    name: "我的手绘",
    category: "floor",
    base_id: "source:" + "a".repeat(64),
    color: "#ffffff",
    repeat: 2,
    rotation: 90,
    roughness: 0.8,
    origin: "draw",
  };
  const workspace = restoreSurfaces("floor", bases, null, old);
  assert.equal(workspace.mode, "ai");
  assert.equal(workspace.drafts.draw.base_id, old.base_id);
  assert.equal(workspace.drafts.ai.base_id, "");
  assert.equal(workspace.drafts.preset.base_id, "floor-oak");
  workspace.drafts.ai.name = "AI 新素材";
  assert.equal(workspace.drafts.draw.name, "我的手绘");
});

test("新笔画自动同步时保留纹理方向、密度和染色，新 AI 结果恢复原色", () => {
  const draft = {
    name: "手绘",
    color: "#cccccc",
    repeat: 3,
    rotation: 90,
    roughness: 0.45,
  };
  const source = { id: "source:" + "b".repeat(64), origin: "draw" };
  const drawn = sourceRecipe(draft, source, false);
  assert.equal(drawn.color, "#cccccc");
  assert.equal(drawn.repeat, 3);
  assert.equal(drawn.rotation, 90);
  const ai = sourceRecipe(draft, { ...source, origin: "ai" });
  assert.equal(ai.color, "#ffffff");
  assert.equal(ai.repeat, 1);
  assert.equal(ai.rotation, 0);
  assert.equal(draft.color, "#cccccc");
});

test("刷新恢复所选方式和各自参数，拒绝跨用途或非法草稿", () => {
  const workspace = restoreSurfaces("floor", bases);
  workspace.mode = "draw";
  workspace.drafts.draw.name = "几何砖";
  assert.deepEqual(
    restoreSurfaces("floor", bases, JSON.parse(JSON.stringify(workspace))),
    workspace,
  );
  const invalid = structuredClone(workspace);
  invalid.drafts.draw.category = "walls";
  invalid.drafts.ai.repeat = NaN;
  const restored = restoreSurfaces("floor", bases, invalid);
  assert.equal(restored.drafts.draw.category, "floor");
  assert.equal(restored.drafts.ai.repeat, 1);
});
