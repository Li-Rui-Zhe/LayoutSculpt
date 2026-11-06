import test from "node:test";
import assert from "node:assert/strict";
import { exportPixelRatio } from "../src/viewer/exportResolution.js";
import { surfaceHistory, surfacePixelKey } from "../src/diy/surfaceHistory.js";
import { visibleTargets } from "../src/library/projectTargets.js";
import { furnitureTemplate } from "../src/diy/templates.js";
import { designBounds, designIssues } from "../src/diy/design.js";
import { followAttachments } from "../src/editor/attachments.js";
import { downloadFile } from "../src/downloadFile.js";

test("小窗口导出长边仍为 2K，4K 请求遵守显卡限制", () => {
  for (const [w, h] of [
    [858, 510],
    [320, 600],
    [2400, 900],
  ]) {
    assert.equal(Math.max(w, h) * exportPixelRatio(w, h), 2048);
    assert.equal(Math.max(w, h) * exportPixelRatio(w, h, 4096, 2048), 2048);
  }
});
test("材质滑块连续调整合并撤销，撤销后新改动清除重做", () => {
  let s = { present: { repeat: 1 }, past: [], future: [], time: 0 };
  s = surfaceHistory(s, {
    type: "set",
    value: { repeat: 2 },
    time: 100,
    group: "repeat",
  });
  s = surfaceHistory(s, {
    type: "set",
    value: { repeat: 3 },
    time: 200,
    group: "repeat",
  });
  assert.equal(s.past.length, 1);
  s = surfaceHistory(s, { type: "undo" });
  assert.equal(s.present.repeat, 1);
  s = surfaceHistory(s, { type: "redo" });
  assert.equal(s.present.repeat, 3);
  s = surfaceHistory(s, { type: "undo" });
  s = surfaceHistory(s, { type: "set", value: { repeat: 4 }, time: 300 });
  assert.equal(s.future.length, 0);
  assert.equal(surfaceHistory(s, { type: "undo" }).present.repeat, 1);
});
test("材质名称和光泽不触发像素重建，但铺贴密度会触发", () => {
  const draft = {
    category: "floor",
    base_id: "floor-oak",
    color: "#ffffff",
    repeat: 1,
    rotation: 0,
  };
  assert.equal(
    surfacePixelKey(draft),
    surfacePixelKey({ ...draft, name: "新名称", roughness: 0.9 }),
  );
  assert.notEqual(
    surfacePixelKey(draft),
    surfacePixelKey({ ...draft, repeat: 2 }),
  );
});
test("默认版本筛选与搜索始终保留用户已选中的旧版本", () => {
  const groups = [
    { name: "家", versions: [{ id: "new" }, { id: "old" }] },
    { name: "其他", versions: [{ id: "x" }] },
  ];
  assert.deepEqual(
    visibleTargets(groups).map((g) => g.versions.map((v) => v.id)),
    [["new"], ["x"]],
  );
  assert.deepEqual(
    visibleTargets(groups, { query: "其他", selected: "old" }).map((g) =>
      g.versions.map((v) => v.id),
    ),
    [["old"], ["x"]],
  );
  assert.equal(visibleTargets(groups, { history: true })[0].versions.length, 2);
});
test("新增家具模板尺寸合理、部件可编辑且无重复 ID", () => {
  for (const kind of [
    "bed",
    "sofa",
    "desk",
    "shelf",
    "chair",
    "cabinet",
    "table",
  ]) {
    const design = furnitureTemplate(kind);
    assert.deepEqual(designIssues(design), [], kind);
    assert.equal(
      new Set(design.parts.map((p) => p.id)).size,
      design.parts.length,
    );
    assert.ok(designBounds(design).dimensions.every((n) => n > 0 && n < 3));
  }
});
test("墙上陈设随墙平移旋转，删除墙后隐藏保留；不篡改独立陈设", () => {
  const doc = {
    furniture: { items: [] },
    layout: {
      walls: [{ id: "w", start: { x: 0, y: 0 }, end: { x: 4, y: 0 } }],
      presentation_layers: [
        {
          id: "a",
          parent_wall_id: "w",
          x: 2,
          y: 0.2,
          rotation: 0,
          visible: true,
        },
        { id: "b", x: 3, y: 3 },
      ],
    },
  };
  const changed = structuredClone(doc);
  changed.layout.walls[0] = {
    id: "w",
    start: { x: 1, y: 1 },
    end: { x: 1, y: 5 },
  };
  const after = followAttachments(doc, changed);
  assert.ok(Math.abs(after.layout.presentation_layers[0].x - 0.8) < 1e-8);
  assert.equal(after.layout.presentation_layers[0].y, 3);
  assert.equal(after.layout.presentation_layers[0].rotation, 90);
  assert.deepEqual(
    after.layout.presentation_layers[1],
    doc.layout.presentation_layers[1],
  );
  const removed = followAttachments(doc, {
    ...doc,
    layout: { ...doc.layout, walls: [] },
  });
  assert.equal(removed.layout.presentation_layers[0].visible, false);
  assert.equal(removed.layout.presentation_layers[0].parent_wall_id, null);
  assert.equal(doc.layout.presentation_layers[0].visible, true);
});
test("成果下载失败保留服务端原因，成功后才交给浏览器", async (t) => {
  let clicks = 0;
  const original = globalThis.document;
  globalThis.document = {
    body: { appendChild() {} },
    createElement: () => ({
      click() {
        clicks++;
      },
      remove() {},
    }),
  };
  t.after(() => {
    globalThis.document = original;
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(URL, "createObjectURL", () => "blob:test");
  t.mock.method(URL, "revokeObjectURL", () => {});
  const mocked = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ detail: "缺少成果附件" }, { status: 422 }),
  );
  await assert.rejects(downloadFile("/api/bundle", "x.zip"), /缺少成果附件/);
  assert.equal(clicks, 0);
  mocked.mock.mockImplementation(
    async () => new Response(new Blob(["archive"])),
  );
  await downloadFile("/api/bundle", "x.zip");
  assert.equal(clicks, 1);
  t.mock.timers.tick(60000);
});
