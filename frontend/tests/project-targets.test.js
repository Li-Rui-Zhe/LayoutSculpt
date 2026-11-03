import test from "node:test";
import assert from "node:assert/strict";
import { targetGroups, nextDesignName } from "../src/library/projectTargets.js";

test("失败的中间版本不拆散项目，版本编号稳定，最新可用版本在前", () => {
  const jobs = [
    { id: "a", name: "家.png", status: "succeeded", created_at: "2026-01-01" },
    {
      id: "b",
      name: "家 · 设计",
      edited_of: "a",
      status: "failed",
      created_at: "2026-01-02",
    },
    {
      id: "c",
      name: "家 · 设计 · V3",
      edited_of: "b",
      status: "succeeded",
      created_at: "2026-01-03",
    },
  ];
  assert.deepEqual(
    targetGroups(jobs).map((g) => [
      g.name,
      g.versions.map((j) => [j.id, j.version]),
    ]),
    [
      [
        "家",
        [
          ["c", 3],
          ["a", 1],
        ],
      ],
    ],
  );
});
test("新名称去掉交错的旧后缀，并为版本号保留长度", () => {
  assert.equal(nextDesignName("家 · V2 · 设计 · 微调", 4), "家 · V4");
  assert.equal(nextDesignName("家".repeat(120), 12).length, 120);
});
