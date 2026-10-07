// Render the real application viewer in installed Edge; no browser download needed.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const [modelUrl, output = "data/visual-review"] = process.argv.slice(2);
if (!modelUrl)
  throw new Error(
    "Usage: node scripts/review/visual_review.mjs <model-url> [output-dir]",
  );
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (url) => {
    const { StudioScene } = await import("/src/viewer/StudioScene.js");
    document.getElementById("root").remove();
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh";
    document.body.append(host);
    window.review = new StudioScene(host, {
      onError: (e) => {
        if (e) throw new Error(e);
      },
    });
    window.review.apply({ selected: {}, preset: "midday", daylight: 74 });
    await window.review.load(url);
  }, modelUrl);
  for (const view of ["day", "night", "top", "full"]) {
    await page.evaluate((mode) => {
      window.review.settings({
        shadows: true,
        rotate: false,
        grid: false,
        cutaway: mode !== "full",
      });
      window.review.reset(mode === "top");
      window.review.apply({
        selected: {},
        preset: mode === "night" ? "night" : "midday",
        daylight: 74,
      });
    }, view);
    const camera = await page.evaluate(() => ({
      perspective: !!window.review.camera.isPerspectiveCamera,
      top: window.review.topView,
      aoPerspective: window.review.ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA,
    }));
    if (
      camera.perspective !== (view !== "top") ||
      camera.aoPerspective !== Number(view !== "top")
    )
      throw new Error(`Camera/pass mismatch: ${JSON.stringify(camera)}`);
    await page.waitForTimeout(1700);
    await page.screenshot({ path: path.resolve(output, `${view}.png`) });
  }
  const stats = await page.evaluate(() => ({
    lights: window.review.model?.userData.designLights?.length,
    geometries: window.review.renderer.info.memory.geometries,
    calls: window.review.renderer.info.render.calls,
  }));
  console.log(JSON.stringify({ output, stats, errors }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
