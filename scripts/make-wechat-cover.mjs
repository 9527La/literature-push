// 品牌封面图生成：蓝底双星芒 + 电研新视界 + 当日日期（900×383 = 公众号封面 2.35:1，2x 输出）。
// 双模式：CLI（node scripts/make-wechat-cover.mjs [date] [out]）或被 publish-wechat-draft.mjs 导入。
// 封面含日期 → 每期不同 → 由 publish 侧按日期缓存 media_id（PLAN-DAILY-UPGRADE）。
import { chromium } from "playwright-core";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { businessToday } from "../server/date/normalize.js";

/** 生成某期封面 PNG（2x = 1800×766）。date = 期号日（YYYY-MM-DD，默认北京今天）。 */
export async function renderCover(date, outPath) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}body{width:900px;height:383px;overflow:hidden}</style></head>
<body>
<svg width="900" height="383" viewBox="0 0 900 383" xmlns="http://www.w3.org/2000/svg">
  <rect width="900" height="383" fill="#3157d5"/>
  <circle cx="770" cy="60" r="150" fill="#ffffff" opacity="0.07"/>
  <circle cx="60" cy="330" r="100" fill="#ffffff" opacity="0.06"/>
  <circle cx="840" cy="320" r="56" fill="#ffffff" opacity="0.05"/>
  <!-- 双星芒（与 favicon.svg 同源几何） -->
  <path d="M120 106 L137 168 L199 185 L137 202 L120 264 L103 202 L41 185 L103 168 Z" fill="#ffffff"/>
  <path d="M182 62 L191 93 L222 102 L191 111 L182 142 L173 111 L142 102 L173 93 Z" fill="#ffffff" opacity="0.9"/>
  <text x="238" y="172" font-size="64" font-weight="700" fill="#ffffff" font-family="'Microsoft YaHei','PingFang SC',sans-serif">电研新视界</text>
  <text x="240" y="226" font-size="26" fill="#ffffff" opacity="0.85" font-family="'Microsoft YaHei','PingFang SC',sans-serif">每日文献速递 · AI 研究速览 · 电力资讯</text>
  <text x="240" y="292" font-size="30" font-weight="600" fill="#ffffff" opacity="0.95" font-family="'Microsoft YaHei','PingFang SC',sans-serif">日报｜${esc(date)}</text>
</svg>
</body></html>`;

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 383 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: 900, height: 383 } });
  await browser.close();
  return outPath;
}

async function main() {
  const date = process.argv[2] || businessToday();
  const out = resolve(process.argv[3] || "assets/wechat-cover.png");
  mkdirSync(dirname(out), { recursive: true });
  await renderCover(date, out);
  console.log(`[wechat-cover] date=${date} -> ${out} (1800x766)`);
}

// 仅 CLI 直跑时执行（被 publish-wechat-draft.mjs 导入时不执行——否则会用调用方的
// process.argv 当默认参数，曾把 .json 路径当截图输出导致 unsupported mime type）。
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
