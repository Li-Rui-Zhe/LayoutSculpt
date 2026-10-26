import { chromium } from "@playwright/test";

export function reviewBrowserOptions(
  platform = process.platform,
  channel = process.env.REVIEW_BROWSER_CHANNEL,
) {
  const selected = channel || (platform === "win32" ? "msedge" : "chromium");
  return {
    headless: true,
    ...(selected === "chromium" ? {} : { channel: selected }),
  };
}

export async function launchReviewBrowser() {
  try {
    return await chromium.launch(reviewBrowserOptions());
  } catch (error) {
    throw new Error(
      "无法启动验收浏览器。Windows 默认使用 Edge；Mac 使用 pnpm exec playwright install chromium 安装测试浏览器。可用 REVIEW_BROWSER_CHANNEL 指定浏览器。",
      { cause: error },
    );
  }
}
