import { expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { launchReviewBrowser } from "./browser.mjs";
const catalog = JSON.parse(await readFile("frontend/src/library/lightingCatalog.json", "utf8"));
const browser = await launchReviewBrowser();
try {
  const page = await browser.newPage({viewport:{width:1600,height:1050},deviceScaleFactor:2});
  const errors=[];
  page.on("pageerror", e=>errors.push(e.message));
  await page.route("**/api/**", route => {
    if (["GET","HEAD"].includes(route.request().method())) return route.continue();
    return route.fulfill({status:409,json:{detail:"缩略图生成不写入任务"}});
  });
  await page.goto(`${process.env.STUDIO_BASE_URL || "http://127.0.0.1:5176"}/?project=sample&assetType=lighting#library`);
  await expect(page.getByLabel("灯具素材列表").getByRole("button")).toHaveCount(6);
  for (const item of catalog) {
    await page.getByLabel("灯具素材列表").getByRole("button",{name:new RegExp(item.name)}).click();
    await expect(page.locator(".lighting-model")).toHaveAttribute("data-ready","true",{timeout:30000});
    const grid = page.locator(".lighting-model").getByRole("button", {name:"网格",exact:true});
    if (await grid.getAttribute("aria-pressed") === "true") await grid.click();
    await page.locator(".lighting-model canvas").screenshot({path:`public/models/lights/${item.kind}.png`,
      style:".lighting-model .diy-view-toolbar,.lighting-model .diy-preview-hint,.lighting-model .diy-preview-message{visibility:hidden !important}"});
  }
  expect(errors).toEqual([]);
  console.log("六款灯具均成功载入，已生成真实模型缩略图。");
} finally {await browser.close();}
