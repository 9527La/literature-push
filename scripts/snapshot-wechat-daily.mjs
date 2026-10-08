// 一次性：公众号日报 HTML → 手机宽度截图（414px，全页）
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const input = resolve(process.argv[2] || "data/wechat-drafts/2026-10-08.html");
const output = resolve(process.argv[3] || "_tmp/wechat-daily-preview.png");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 414, height: 900 } });
await page.goto(pathToFileURL(input).href, { waitUntil: "networkidle" });
await page.screenshot({ path: output, fullPage: true });
await browser.close();
console.log(`[snapshot-wechat] ${output}`);
