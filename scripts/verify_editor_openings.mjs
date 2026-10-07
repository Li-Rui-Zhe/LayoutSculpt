import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const id = process.argv[2];
if (!/^[a-f0-9]{32}$/.test(id || ""))
  throw new Error("请提供已有成功任务 ID。");
const output = "data/visual-review/editor-openings";
await mkdir(output, { recursive: true });
const fixture = {
  title: "门窗交互验收",
  confidence: 1,
  scale_note: "浏览器测试数据",
  warnings: [],
  outline: [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 6 },
    { x: 0, y: 6 },
  ],
  rooms: [
    {
      id: "room",
      name: "测试空间",
      kind: "living",
      polygon: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 6 },
        { x: 0, y: 6 },
      ],
      floor_finish: "default",
    },
  ],
  walls: [
    { id: "w1", start: { x: 0, y: 0 }, end: { x: 8, y: 0 } },
    { id: "w2", start: { x: 8, y: 0 }, end: { x: 8, y: 6 } },
    { id: "w3", start: { x: 8, y: 6 }, end: { x: 0, y: 6 } },
    { id: "w4", start: { x: 0, y: 6 }, end: { x: 0, y: 0 } },
    { id: "short", start: { x: 2, y: 2 }, end: { x: 2.4, y: 2 } },
  ].map((wall) => ({
    ...wall,
    height: 2.7,
    thickness: 0.12,
    exterior: wall.id !== "short",
    finish: "default",
  })),
  openings: [],
  lights: [],
  furniture: [
    {
      name: "测试椅子",
      kind: "chair",
      room_id: "room",
      x: 3,
      y: 3,
      width: 0.45,
      depth: 0.45,
      height: 0.8,
      rotation: 0,
    },
  ],
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
  const baselineHeight = (await svg.boundingBox()).height;
  const stable = async (label) => {
    expect(
      Math.abs((await svg.boundingBox()).height - baselineHeight),
      label,
    ).toBeLessThan(1);
  };
  const x = page.getByRole("spinbutton", { name: "左右位置", exact: true });
  await x.fill("-2");
  await x.press("Enter");
  await expect(page.locator(".edit-check-summary")).toContainText("布局问题");
  await stable("出现布局问题不应改变画布高度");
  await page.getByRole("button", { name: "查看布局问题", exact: true }).click();
  await expect(page.locator(".edit-issues")).toBeVisible();
  await stable("展开问题详情不应改变画布高度");
  await page.screenshot({ path: `${output}/validation.png` });
  await page.keyboard.press("Escape");
  await expect(page.locator(".edit-issues")).toBeHidden();
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect(page.locator(".edit-check-summary")).toContainText(
    "布局检查通过",
  );
  await stable("消除问题不应改变画布高度");
  checks.push("问题出现、展开、收起与消除时，画布高度变化小于 1px");

  await page.getByRole("button", { name: "门窗", exact: true }).click();
  const choice = page.getByRole("combobox", { name: "添加开口的墙体" });
  await choice.selectOption("w2");
  await page.getByRole("button", { name: "门", exact: true }).click();
  const composer = page.getByRole("region", {
    name: "新增门参数",
    exact: true,
  });
  await expect(composer).toBeVisible();
  expect((await saved()).layout.openings.length).toBe(0);
  await composer
    .getByRole("spinbutton", { name: "开口宽度", exact: true })
    .fill("0.85");
  await composer
    .getByRole("spinbutton", { name: "距墙起点", exact: true })
    .fill("1.2");
  await composer.getByText("门扇与开启方式", { exact: true }).click();
  await composer
    .getByRole("combobox", { name: "铰链位置", exact: true })
    .selectOption("end");
  await composer
    .getByRole("combobox", { name: "开启方向", exact: true })
    .selectOption("right");
  await composer
    .getByRole("spinbutton", { name: "开启角度", exact: true })
    .fill("65");
  await expect(svg.locator("[data-opening-preview]")).toHaveCount(1);
  await page.screenshot({ path: `${output}/door-parameters.png` });
  await composer
    .getByRole("button", { name: "确认添加门", exact: true })
    .click();
  await expect
    .poll(async () => (await saved()).layout.openings.at(-1)?.wall_id)
    .toBe("w2");
  expect((await saved()).layout.openings.at(-1).kind).toBe("door");
  expect((await saved()).layout.openings.at(-1)).toMatchObject({
    width: 0.85,
    offset: 1.2,
    hinge: "end",
    swing: "right",
    angle: 65,
  });
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect.poll(async () => (await saved()).layout.openings.length).toBe(0);
  await page.getByRole("button", { name: "重做设计", exact: true }).click();
  await expect.poll(async () => (await saved()).layout.openings.length).toBe(1);
  checks.push(
    "新增前设置尺寸、位置及门扇方向，预览不写草稿，添加只占一次撤销记录",
  );
  await page
    .getByRole("button", { name: "在图上选择安装墙体", exact: true })
    .click();
  const p = await svg.evaluate((element) => {
    const value = new DOMPoint(6, 6).matrixTransform(element.getScreenCTM());
    return { x: value.x, y: value.y };
  });
  const beforeWalls = JSON.stringify((await saved()).layout.walls);
  await page.mouse.click(p.x, p.y);
  await expect(choice).toHaveValue("w3");
  await expect(
    page.getByRole("button", { name: "门窗", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(JSON.stringify((await saved()).layout.walls)).toBe(beforeWalls);
  await page.getByRole("button", { name: "窗户", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "窗台离地", exact: true })
    .fill("1.1");
  await page.getByRole("button", { name: "确认添加窗户", exact: true }).click();
  await expect
    .poll(async () => (await saved()).layout.openings.at(-1)?.wall_id)
    .toBe("w3");
  expect((await saved()).layout.openings.at(-1).kind).toBe("window");
  checks.push("列表选墙与图上选墙均安装到对应墙体，选墙不移动墙体或切换工具");

  const count = (await saved()).layout.openings.length;
  await choice.selectOption("short");
  await page.getByRole("button", { name: "门", exact: true }).click();
  await expect(page.locator(".opening-feedback")).toContainText("超出墙体");
  await expect(
    page.getByRole("button", { name: "确认添加门", exact: true }),
  ).toBeDisabled();
  expect((await saved()).layout.openings.length).toBe(count);
  await stable("安装失败提示不应压缩画布");
  await page.getByRole("button", { name: "适配可用空位", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "开口宽度", exact: true }),
  ).toHaveValue("0.4");
  await expect(
    page.getByRole("button", { name: "确认添加门", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("spinbutton", { name: "开口宽度", exact: true })
    .fill("");
  await expect(
    page.getByRole("button", { name: "确认添加门", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "取消添加", exact: true }).click();
  expect((await saved()).layout.openings.length).toBe(count);
  await expect(svg.locator("[data-opening-preview]")).toHaveCount(0);
  checks.push(
    "短墙先展示可调参数，可显式适配；空输入不可提交，取消不修改草稿，画布高度不变",
  );
  await page.getByRole("button", { name: "通道", exact: true }).click();
  await choice.selectOption("w4");
  await page.getByRole("button", { name: "开放通道", exact: true }).click();
  await page
    .getByRole("button", { name: "确认添加开放通道", exact: true })
    .click();
  await expect
    .poll(async () => (await saved()).layout.openings.at(-1)?.wall_id)
    .toBe("w4");
  expect((await saved()).layout.openings.at(-1).kind).toBe("passage");
  await page.getByRole("button", { name: "墙体", exact: true }).click();
  await page
    .locator(".edit-object-list")
    .getByRole("button", { name: /墙体 2/ })
    .click();
  await page.getByRole("button", { name: "添加窗户", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "距墙起点", exact: true })
    .fill("1.5");
  await expect(page.locator(".opening-feedback")).toContainText("重叠");
  await expect(
    page.getByRole("button", { name: "确认添加窗户", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("spinbutton", { name: "距墙起点", exact: true })
    .fill("3");
  await page
    .getByRole("spinbutton", { name: "开口高度", exact: true })
    .fill("2");
  await expect(page.locator(".opening-feedback")).toContainText("顶部");
  await page
    .getByRole("spinbutton", { name: "开口高度", exact: true })
    .fill("1.2");
  await page.getByRole("button", { name: "确认添加窗户", exact: true }).click();
  await expect
    .poll(async () => (await saved()).layout.openings.at(-1)?.wall_id)
    .toBe("w2");
  checks.push("开放通道与墙体属性中的添加入口均使用指定墙体");
  await page.getByRole("button", { name: "墙体", exact: true }).click();
  await page
    .locator(".edit-object-list")
    .getByRole("button", { name: /墙体 3/ })
    .click();
  await page.getByRole("button", { name: "门窗", exact: true }).click();
  await expect(choice).toHaveValue("w3");
  await page.getByRole("button", { name: "窗户", exact: true }).click();
  await page.getByRole("button", { name: "确认添加窗户", exact: true }).click();
  await expect
    .poll(async () => (await saved()).layout.openings.at(-1)?.wall_id)
    .toBe("w3");
  checks.push("先选墙体再切到门窗时，保留安装目标，不被已有门窗覆盖");
  await page.screenshot({ path: `${output}/openings.png` });

  const jobs = await (
    await page.request.get("http://127.0.0.1:8000/api/jobs")
  ).json();
  const reviewJob = jobs.items.find((job) => job.status === "awaiting_review");
  if (!reviewJob) throw new Error("缺少待核对任务，无法验证结构确认模式。");
  const reviewContext = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
  });
  const reviewPage = await reviewContext.newPage();
  reviewPage.on("pageerror", (error) => errors.push(error.message));
  const mutations = [];
  await reviewPage.route("**/api/**", (route) => {
    if (!["GET", "HEAD"].includes(route.request().method())) {
      mutations.push(route.request().url());
      return route.abort();
    }
    return route.fallback();
  });
  const reviewFixture = structuredClone(fixture);
  reviewFixture.walls.at(-1).end.x = 3;
  await reviewPage.route(
    `**/api/jobs/${reviewJob.id}/artifacts/structure.json`,
    (route) => route.fulfill({ json: reviewFixture }),
  );
  await reviewPage.addInitScript(
    (jobId) => localStorage.setItem("habitat-job", jobId),
    reviewJob.id,
  );
  await reviewPage.goto("http://127.0.0.1:5173/");
  await reviewPage
    .getByRole("button", { name: "调整识别结构", exact: true })
    .click();
  const reviewSaved = () =>
    reviewPage.evaluate(
      (jobId) =>
        JSON.parse(localStorage.getItem(`habitat-edit:${jobId}:structure`))
          ?.document,
      reviewJob.id,
    );
  await expect.poll(async () => !!(await reviewSaved())).toBe(true);
  const confirmReview = reviewPage.getByRole("button", {
    name: "确认修改并继续生成",
    exact: true,
  });
  const ack = reviewPage.getByRole("checkbox", {
    name: "我已核对修改后的墙体和门窗",
    exact: true,
  });
  await ack.check();
  await expect(confirmReview).toBeEnabled();
  await reviewPage.getByRole("button", { name: "门窗", exact: true }).click();
  const reviewChoice = reviewPage.getByRole("combobox", {
    name: "添加开口的墙体",
    exact: true,
  });
  await reviewChoice.selectOption("short");
  await reviewPage.getByRole("button", { name: "门", exact: true }).click();
  await expect(ack).not.toBeChecked();
  await expect(
    reviewPage.getByRole("button", { name: "确认添加门", exact: true }),
  ).toBeEnabled();
  await ack.check();
  await expect(confirmReview).toBeDisabled();
  expect((await reviewSaved()).layout.openings).toHaveLength(0);
  await reviewPage.screenshot({ path: `${output}/review-one-meter-wall.png` });
  await reviewChoice.selectOption("w3");
  await reviewPage
    .getByRole("spinbutton", { name: "开口宽度", exact: true })
    .fill("0.8");
  const reviewSvg = reviewPage.getByRole("application", {
    name: "人工设计平面图",
    exact: true,
  });
  const anchorPoint = await reviewSvg.evaluate((element) => {
    const point = new DOMPoint(5, 6).matrixTransform(element.getScreenCTM());
    return { x: point.x, y: point.y };
  });
  await reviewPage.mouse.click(anchorPoint.x, anchorPoint.y);
  await expect(
    reviewPage.getByRole("spinbutton", { name: "距墙起点", exact: true }),
  ).toHaveValue("2.6");
  await reviewPage
    .getByRole("button", { name: "确认添加门", exact: true })
    .click();
  await expect
    .poll(async () => (await reviewSaved()).layout.openings.length)
    .toBe(1);
  expect((await reviewSaved()).layout.openings[0]).toMatchObject({
    wall_id: "w3",
    width: 0.8,
    offset: 2.6,
  });
  await expect(ack).not.toBeChecked();
  await expect(confirmReview).toBeDisabled();
  await ack.check();
  await expect(confirmReview).toBeEnabled();
  await reviewPage.getByRole("button", { name: "窗户", exact: true }).click();
  await reviewPage.setViewportSize({ width: 390, height: 844 });
  const mobileComposer = reviewPage.getByRole("region", {
    name: "新增窗户参数",
    exact: true,
  });
  await mobileComposer.scrollIntoViewIfNeeded();
  await expect(
    mobileComposer.getByRole("spinbutton", { name: "开口宽度", exact: true }),
  ).toBeVisible();
  expect(
    await reviewPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await reviewPage.screenshot({
    path: `${output}/review-mobile.png`,
    fullPage: true,
  });
  await mobileComposer
    .getByRole("button", { name: "取消添加", exact: true })
    .click();
  expect((await reviewSaved()).layout.openings.length).toBe(1);
  expect(mutations).toEqual([]);
  expect(
    (
      await (
        await page.request.get(`http://127.0.0.1:8000/api/jobs/${reviewJob.id}`)
      ).json()
    ).status,
  ).toBe("awaiting_review");
  checks.push(
    "结构核对支持 1 米墙加 0.9 米门，图上定位保留尺寸，修改后重新人工确认，待添加时不能生成，手机无横向溢出",
  );
  await reviewContext.close();
  expect(errors).toEqual([]);
  const report = { id, checks, errors };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
