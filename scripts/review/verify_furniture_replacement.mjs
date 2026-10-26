// 隔离数据、固定 AI 响应、真实 GLB：换款不修改用户任务或调用在线 AI。
import { expect } from "@playwright/test";
import { launchReviewBrowser } from "./browser.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findPython } from "../python.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const output = path.join(
  root,
  "data/visual-review/furniture-replacement",
  randomUUID(),
);
await mkdir(output, { recursive: true });
const socket = createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const python = findPython(root);
const child = spawn(
  python,
  [
    "-m",
    "uvicorn",
    "backend.tests.prelaunch_app:app",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      STUDIO_TEST_PORT: String(port),
      STUDIO_TEST_DATA: path.join(output, "server"),
    },
  },
);
let logs = "",
  browser,
  page;
child.stderr.on("data", (value) => {
  logs = (logs + value).slice(-10000);
});
const report = { checks: [], errors: [] };
try {
  await expect
    .poll(
      async () => {
        if (child.exitCode !== null) throw Error(logs);
        return fetch(`${base}/api/health`)
          .then((r) => r.ok)
          .catch(() => false);
      },
      { timeout: 30000 },
    )
    .toBe(true);
  browser = await launchReviewBrowser();
  page = await browser.newPage({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  const image = execFileSync(
    python,
    [
      "-c",
      "import sys; from backend.tests.test_workflow import image_bytes; sys.stdout.buffer.write(image_bytes())",
    ],
    { cwd: root, windowsHide: true },
  );
  const created = await page.request.post("/api/jobs", {
    multipart: {
      file: {
        name: "replacement-review.png",
        mimeType: "image/png",
        buffer: image,
      },
      collaboration: "false",
      name: "换款隔离验收",
    },
  });
  expect(created.status()).toBe(201);
  let job = await created.json();
  await expect
    .poll(
      async () => {
        job = await (await page.request.get(`/api/jobs/${job.id}`)).json();
        if (job.status === "failed") throw Error(JSON.stringify(job));
        return job.status;
      },
      { timeout: 30000 },
    )
    .toBe("awaiting_review");
  await page.addInitScript(
    (id) => localStorage.setItem("habitat-job", id),
    job.id,
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "已核对，继续生成", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        job = await (await page.request.get(`/api/jobs/${job.id}`)).json();
        if (job.status === "failed") throw Error(JSON.stringify(job));
        return job.status;
      },
      { timeout: 60000 },
    )
    .toBe("succeeded");
  const candidates = JSON.parse(
    await readFile(
      path.join(output, "server/jobs", job.id, "furnishing-candidates.json"),
      "utf8",
    ),
  );
  expect(candidates.selected).toBeLessThan(candidates.available);
  expect(candidates.items.some((i) => i.styles?.length)).toBe(true);
  report.candidates = {
    available: candidates.available,
    selected: candidates.selected,
  };
  await expect(page.locator("#viewport canvas")).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "平面设计", exact: true }).click();
  await page
    .locator(".edit-tool-tabs")
    .getByRole("button", { name: "家具", exact: true })
    .click();
  await page.getByLabel("设计对象列表").getByRole("button").first().click();
  const readDraft = () =>
    page.evaluate(
      (id) => JSON.parse(localStorage.getItem(`habitat-edit:${id}`)).document,
      job.id,
    );
  const initial = await readDraft();
  await page.getByRole("button", { name: "更换款式", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "更换家具款式" });
  await expect(dialog).toBeVisible();
  await dialog
    .locator(".replacement-cards button")
    .filter({ hasText: "奶油双人小户型沙发" })
    .click();
  await expect(
    dialog.getByText("原位置可用，确认后替换这一件家具。", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "确认替换", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.screenshot({ path: path.join(output, "desktop.png") });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(await readDraft()).toEqual(initial);
  report.checks.push("模型与尺寸可预览，取消不修改草稿");
  await page.getByRole("button", { name: "更换款式", exact: true }).click();
  await dialog
    .locator(".replacement-cards button")
    .filter({ hasText: "奶油双人小户型沙发" })
    .click();
  await expect(
    dialog.getByRole("button", { name: "确认替换", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await dialog.getByRole("button", { name: "确认替换", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  let changed;
  await expect
    .poll(async () => {
      changed = await readDraft();
      return changed.furniture.items[0].asset_id;
    })
    .toMatch(/^snapshot:/);
  for (const key of ["x", "y", "rotation", "room_id", "edit_id"])
    expect(changed.furniture.items[0][key]).toEqual(
      initial.furniture.items[0][key],
    );
  expect(changed.furniture.items).toHaveLength(initial.furniture.items.length);
  await page.getByRole("button", { name: "撤销设计", exact: true }).click();
  await expect
    .poll(async () => (await readDraft()).furniture.items[0].asset_id)
    .toEqual(initial.furniture.items[0].asset_id);
  await page.getByRole("button", { name: "重做设计", exact: true }).click();
  await expect
    .poll(async () => (await readDraft()).furniture.items[0].asset_id)
    .toEqual(changed.furniture.items[0].asset_id);
  report.checks.push("确认只替换一件，原位置与对象身份保留，撤销与重做通过");
  await page.getByLabel("设计对象列表").getByRole("button").first().click();
  await page.getByRole("button", { name: "更换款式", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: path.join(output, "mobile.png") });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const saveResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/jobs/${job.id}/edit`) &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "保存并生成三维", exact: true })
    .click();
  const saved = await saveResponse;
  expect(saved.status()).toBe(201);
  const version = await saved.json();
  let finished;
  await expect
    .poll(
      async () => {
        finished = await (
          await page.request.get(`/api/jobs/${version.id}`)
        ).json();
        if (finished.status === "failed") throw Error(JSON.stringify(finished));
        return finished.status;
      },
      { timeout: 60000 },
    )
    .toBe("succeeded");
  const exported = await (
    await page.request.get(finished.result.layout_url)
  ).json();
  expect(exported.furniture[0].asset_id).toBe(
    changed.furniture.items[0].asset_id,
  );
  expect(exported.furniture[0].source_asset_id).toBe(
    changed.furniture.items[0].source_asset_id,
  );
  expect(exported.rooms).toEqual(initial.layout.rooms);
  expect(exported.walls).toEqual(initial.layout.walls);
  expect(exported.openings).toEqual(initial.layout.openings);
  expect(report.errors).toEqual([]);
  report.checks.push("手机换款无横向溢出；保存真实 GLB 与具体素材引用一致");
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ output, ...report }, null, 2));
} catch (error) {
  await page
    ?.screenshot({ path: path.join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  await writeFile(path.join(output, "failure.txt"), `${error.stack}\n${logs}`);
  throw error;
} finally {
  await browser?.close();
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {}
  } else child.kill("SIGTERM");
}
