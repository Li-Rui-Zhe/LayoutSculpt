import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { contains } from "../../frontend/src/editor/geometry.js";

const id = process.argv[2];
if (!/^[a-f0-9]{32}$/.test(id || "")) throw Error("请提供已有成功任务 ID。");
const output = "data/visual-review/editor-outline";
await mkdir(output, { recursive: true });
const rectangle = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 6 },
  { x: 0, y: 6 },
];
const fixture = {
  title: "自动轮廓交互验收",
  confidence: 1,
  scale_note: "浏览器测试数据",
  warnings: [],
  outline: rectangle,
  rooms: [
    {
      id: "room",
      name: "测试空间",
      kind: "living",
      polygon: rectangle,
      floor_finish: "default",
    },
  ],
  walls: rectangle.map((start, i) => ({
    id: `w${i}`,
    start,
    end: rectangle[(i + 1) % 4],
    thickness: 0.12,
    height: 2.7,
    exterior: true,
  })),
  openings: [],
  lights: [],
  furniture: [],
  furniture_notes: [],
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [],
  checks = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1050 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (jobId) => localStorage.setItem("habitat-job", jobId),
    id,
  );
  await page.route(`**/api/jobs/${id}/artifacts/layout.json`, (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "手动调整布局", exact: true }).click();
  const svg = page.getByRole("application", { name: "人工设计平面图" });
  await expect(svg).toBeVisible({ timeout: 30000 });
  const saved = () =>
    page.evaluate(
      (jobId) =>
        JSON.parse(localStorage.getItem(`habitat-edit:${jobId}`))?.document,
      id,
    );
  await expect.poll(async () => !!(await saved())).toBe(true);
  expect((await saved()).layout.outline).toEqual(rectangle);
  await expect(
    page.getByRole("button", { name: "户型轮廓", exact: true }),
  ).toHaveCount(0);
  checks.push("进入编辑器保留原结构，移除独立的轮廓编辑工具");
  const clickPoint = async (x, y) => {
    const p = await svg.evaluate(
      (element, coordinates) => {
        const point = new DOMPoint(...coordinates).matrixTransform(
          element.getScreenCTM(),
        );
        return { x: point.x, y: point.y };
      },
      [x, y],
    );
    await page.mouse.click(p.x, p.y);
  };
  await page.getByRole("button", { name: "地板 / 空间", exact: true }).click();
  await page
    .getByRole("button", { name: "绘制新空间 / 地板", exact: true })
    .click();
  for (const [x, y] of [
    [8, 1],
    [8.6, 1],
    [8.6, 3],
    [8, 3],
  ])
    await clickPoint(x, y);
  await page.getByRole("button", { name: "完成绘制", exact: true }).click();
  await expect.poll(async () => (await saved()).layout.rooms.length).toBe(2);
  const expanded = await saved();
  expect(contains({ x: 8.5, y: 2 }, expanded.layout.outline)).toBe(true);
  expect(contains({ x: 8.5, y: 4 }, expanded.layout.outline)).toBe(false);
  await expect(
    page.getByRole("button", { name: "保存并生成三维", exact: true }),
  ).toBeEnabled();
  expect(
    (await svg.locator("[data-plan-outline]").getAttribute("points")).split(" ")
      .length,
  ).toBe(expanded.layout.outline.length);
  await page.screenshot({ path: `${output}/auto-fit.png` });
  await writeFile(`${output}/document.json`, JSON.stringify(expanded, null, 2));
  checks.push(
    "新增原轮廓外的相连空间可自动扩展，凹角保留，提交不再要求手动画轮廓",
  );
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect
    .poll(async () => (await saved()).layout.outline)
    .toEqual(rectangle);
  await page.getByRole("button", { name: "重做设计", exact: true }).click();
  await expect
    .poll(async () => (await saved()).layout.outline)
    .toEqual(expanded.layout.outline);
  await page.getByRole("button", { name: "还原原方案", exact: true }).click();
  await expect
    .poll(async () => (await saved()).layout.outline)
    .toEqual(rectangle);
  checks.push("新增空间与自动轮廓共用一步撤销，重做与还原精确恢复");
  await page.getByRole("button", { name: "墙体", exact: true }).click();
  await page.getByRole("button", { name: "绘制新墙体", exact: true }).click();
  await clickPoint(1, 1);
  await clickPoint(1, 3);
  await expect.poll(async () => (await saved()).layout.walls.length).toBe(5);
  await expect(page.locator(".edit-check-summary")).toContainText(
    "布局检查通过",
  );
  checks.push("绘制新墙体可正常提交，自动轮廓不影响添加墙体");
  await page.getByRole("button", { name: "还原原方案", exact: true }).click();
  await page.getByRole("button", { name: "绘制新墙体", exact: true }).click();
  await clickPoint(8.6, 1);
  await clickPoint(8.6, 3);
  await expect.poll(async () => (await saved()).layout.walls.length).toBe(5);
  await expect(
    page.getByRole("button", { name: "保存并生成三维", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "查看布局问题", exact: true }).click();
  await expect(page.locator(".edit-issues")).toContainText("脱离");
  checks.push("脱离主体的墙体仍提示且拦截生成，不自动桥接");
  expect(errors).toEqual([]);
  const report = { id, checks, errors };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
