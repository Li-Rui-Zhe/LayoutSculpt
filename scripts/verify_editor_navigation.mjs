import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const id = process.argv[2];
if (!/^[a-f0-9]{32}$/.test(id || ""))
  throw new Error("请提供已有成功任务 ID。");
const output = "data/visual-review/editor-navigation";
await mkdir(output, { recursive: true });
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
  await page.goto("http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "手动调整布局", exact: true }).click();
  const svg = page.getByRole("application", { name: "人工设计平面图" });
  await expect(svg).toBeVisible({ timeout: 30000 });
  const saved = () =>
    page.evaluate((jobId) => localStorage.getItem(`habitat-edit:${jobId}`), id);
  await expect.poll(saved).not.toBeNull();
  const baseline = await saved();
  const fit = () =>
    page.getByRole("button", { name: "适配平面图", exact: true }).click();
  const screenPoint = (point) =>
    svg.evaluate((element, p) => {
      const result = new DOMPoint(p.x, p.y).matrixTransform(
        element.getScreenCTM(),
      );
      return { x: result.x, y: result.y };
    }, point);
  const bounds = await svg.boundingBox();
  const mouse = {
    x: bounds.x + bounds.width * 0.7,
    y: bounds.y + bounds.height * 0.55,
  };
  const anchor = await svg.evaluate((element, p) => {
    const result = new DOMPoint(p.x, p.y).matrixTransform(
      element.getScreenCTM().inverse(),
    );
    return { x: result.x, y: result.y };
  }, mouse);
  const original = await svg.getAttribute("viewBox");
  await page.mouse.move(mouse.x, mouse.y);
  await page.mouse.wheel(0, -400);
  await expect(svg).not.toHaveAttribute("viewBox", original);
  const projected = await screenPoint(anchor);
  expect(Math.hypot(projected.x - mouse.x, projected.y - mouse.y)).toBeLessThan(
    0.75,
  );
  expect(await saved()).toBe(baseline);
  checks.push("滚轮以鼠标指向位置缩放，锚点漂移小于 0.75 像素且不修改草稿");

  const drag = async (x, y, button = "left", dx = 60, dy = 35) => {
    await page.mouse.move(x, y);
    await page.mouse.down({ button });
    await page.mouse.move(x + dx, y + dy, { steps: 6 });
    await page.mouse.up({ button });
  };
  await fit();
  const beforePan = await screenPoint(anchor);
  await drag(bounds.x + 25, bounds.y + 25);
  const afterPan = await screenPoint(anchor);
  expect(Math.abs(afterPan.x - beforePan.x - 60)).toBeLessThan(0.75);
  expect(Math.abs(afterPan.y - beforePan.y - 35)).toBeLessThan(0.75);
  expect(await saved()).toBe(baseline);
  checks.push("空白拖动精确平移，不产生设计修改");

  const furniture = svg.locator('g[aria-label^="选择家具"]').first();
  const furniturePoint = async () => {
    const rectangle = await furniture.locator("rect").first().boundingBox();
    return {
      x: rectangle.x + rectangle.width * 0.25,
      y: rectangle.y + rectangle.height * 0.25,
    };
  };
  await fit();
  let p = await furniturePoint();
  await svg.focus();
  await page.keyboard.down("Space");
  await drag(p.x, p.y);
  await page.keyboard.up("Space");
  await expect(svg).not.toHaveAttribute("viewBox", original);
  expect(await saved()).toBe(baseline);
  checks.push("空格拖动家具区域只平移视图，不误移动家具");
  await fit();
  await drag(bounds.x + 25, bounds.y + 25, "middle");
  await expect(svg).not.toHaveAttribute("viewBox", original);
  expect(await saved()).toBe(baseline);
  checks.push("鼠标中键可平移画布");
  await fit();
  await expect(
    page.getByRole("button", { name: "选择并编辑", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "平移画布", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "选择并编辑", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "平移画布", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await svg.focus();
  await page.keyboard.press("ArrowRight");
  expect(await saved()).toBe(baseline);
  p = await furniturePoint();
  await drag(p.x, p.y);
  expect(await saved()).toBe(baseline);
  await page.getByRole("button", { name: "选择并编辑", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "平移画布", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  checks.push("手形模式在对象上拖动也不会改动户型");

  await fit();
  p = await furniturePoint();
  await drag(p.x, p.y, "left", 15, 8);
  await expect.poll(saved).not.toBe(baseline);
  await expect(svg).toHaveAttribute("viewBox", original);
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect.poll(saved).toBe(baseline);
  checks.push("编辑模式仍可拖动家具且可撤销，视图平移不占用撤销历史");

  await svg.focus();
  await page.keyboard.press("+");
  await expect(page.locator(".plan-zoom-value")).not.toHaveText("100%");
  await page.keyboard.press("0");
  await expect(svg).toHaveAttribute("viewBox", original);
  await page.mouse.move(mouse.x, mouse.y);
  await page.mouse.wheel(0, -300);
  await expect(svg).not.toHaveAttribute("viewBox", original);
  await page.mouse.dblclick(bounds.x + 25, bounds.y + 25);
  await expect(svg).toHaveAttribute("viewBox", original);
  const canvas = await svg.boundingBox();
  const controls = await page.locator(".plan-navigation").boundingBox();
  expect(controls.y >= canvas.y + canvas.height - 1).toBe(true);
  checks.push("快捷键、双击适配正常，导航工具位于图纸之外");
  await page.screenshot({ path: `${output}/desktop.png` });
  expect(errors).toEqual([]);
  const report = { id, checks, errors };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
