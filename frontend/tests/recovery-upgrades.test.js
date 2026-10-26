import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPreference,
  rebasePreferences,
} from "../src/hooks/libraryPreferencesState.js";
import { reviewBrowserOptions } from "../../scripts/review/browser.mjs";

test("离线收藏恢复时保留其他页面的修改，取消收藏不会被重放成收藏", () => {
  const changes = [
    { key: "favorites", id: "chair", enabled: true },
    { key: "favorites", id: "bed", enabled: false },
  ];
  const result = rebasePreferences({ favorites: ["bed", "lamp"] }, changes);
  assert.deepEqual(result.favorites, ["lamp", "chair"]);
  assert.deepEqual(rebasePreferences(result, changes), result);
});

test("最近使用保持唯一并限制为 50 项", () => {
  const value = { recent: Array.from({ length: 50 }, (_, i) => String(i)) };
  const result = applyPreference(value, { key: "recent", id: "20" });
  assert.equal(result.recent.length, 50);
  assert.equal(result.recent[0], "20");
  assert.equal(new Set(result.recent).size, 50);
  assert.equal(
    applyPreference(result, { key: "recent", id: "new" }).recent.length,
    50,
  );
});

test("Mac 浏览器验收不依赖 Windows Edge，可显式选择浏览器", () => {
  assert.deepEqual(reviewBrowserOptions("darwin", ""), { headless: true });
  assert.deepEqual(reviewBrowserOptions("win32", ""), {
    headless: true,
    channel: "msedge",
  });
  assert.deepEqual(reviewBrowserOptions("darwin", "chrome"), {
    headless: true,
    channel: "chrome",
  });
});
