// 品牌封面图生成（900×383 = 公众号封面 2.35:1，2x 输出）。
// 双变体：
//   daily（默认）—— 蓝底双星芒 + 电研新视界 + 当日日期
//   topic        —— 深底橙光 + 栏目名/Vol + 专题名 + 日期（专题栏目次条封面）
// 双模式：CLI 或被 publish-wechat-draft.mjs 导入。
// CLI:
//   node scripts/make-wechat-cover.mjs [date] [out]
//   node scripts/make-wechat-cover.mjs --variant topic --title "动态运行包络：从定义到定价" --vol 1 [--date 2026-10-29] [--out path]
import { chromium } from "playwright-core";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { businessToday } from "../server/date/normalize.js";
import { COLUMN_NAME } from "./wechat-column.config.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** 专题名折行：优先在标点后断，其次按字数硬切；最多 2 行，超出加省略号。
 *  每行 8 字是硬约束——次条封面在微信列表里会被裁成 1:1 小方图（取画面中间 383px 宽），
 *  超过这个宽度标题就会被切掉。 */
function wrapTitle(title, perLine = 8) {
  const text = String(title || "").trim();
  if (text.length <= perLine) return [text];
  const punct = ["：", "，", "、", "；", " ", ":"];
  for (let i = Math.min(perLine, text.length - 1); i >= Math.floor(perLine * 0.4); i -= 1) {
    if (punct.includes(text[i])) return [text.slice(0, i + 1), text.slice(i + 1)];
  }
  const second = text.slice(perLine);
  return [text.slice(0, perLine), second.length > perLine ? second.slice(0, perLine - 1) + "…" : second];
}

function dailySvg(date) {
  return `<svg width="900" height="383" viewBox="0 0 900 383" xmlns="http://www.w3.org/2000/svg">
  <rect width="900" height="383" fill="#3157d5"/>
  <circle cx="770" cy="60" r="150" fill="#ffffff" opacity="0.07"/>
  <circle cx="60" cy="330" r="100" fill="#ffffff" opacity="0.06"/>
  <circle cx="840" cy="320" r="56" fill="#ffffff" opacity="0.05"/>
  <path d="M120 106 L137 168 L199 185 L137 202 L120 264 L103 202 L41 185 L103 168 Z" fill="#ffffff"/>
  <path d="M182 62 L191 93 L222 102 L191 111 L182 142 L173 111 L142 102 L173 93 Z" fill="#ffffff" opacity="0.9"/>
  <text x="238" y="172" font-size="64" font-weight="700" fill="#ffffff" font-family="'Microsoft YaHei','PingFang SC',sans-serif">电研新视界</text>
  <text x="240" y="226" font-size="26" fill="#ffffff" opacity="0.85" font-family="'Microsoft YaHei','PingFang SC',sans-serif">每日文献速递 · AI 研究速览 · 电力资讯</text>
  <text x="240" y="292" font-size="30" font-weight="600" fill="#ffffff" opacity="0.95" font-family="'Microsoft YaHei','PingFang SC',sans-serif">日报｜${esc(date)}</text>
</svg>`;
}

/** 专题封面：全部元素居中，且落在中间 383×383 安全区内（次条方图裁切后仍完整）。 */
function topicSvg(date, title, vol, count) {
  const lines = wrapTitle(title, 8);
  const baseY = lines.length === 1 ? 214 : 190;
  const body = lines.map((line, i) =>
    `<text x="450" y="${baseY + i * 58}" text-anchor="middle" font-size="46" font-weight="700" fill="#ffffff" font-family="'Microsoft YaHei','PingFang SC',sans-serif">${esc(line)}</text>`
  ).join("\n  ");
  const volText = `VOL.${String(vol || 1).padStart(3, "0")}`;
  return `<svg width="900" height="383" viewBox="0 0 900 383" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="glow" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#c96442" stop-opacity="0.55"/>
      <stop offset="0.55" stop-color="#2b2b2b" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#232323" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="900" height="383" fill="#232323"/>
  <rect width="900" height="383" fill="url(#glow)"/>
  <text x="450" y="96" text-anchor="middle" font-size="22" fill="#f0c9b6" letter-spacing="5" font-family="'Microsoft YaHei','PingFang SC',sans-serif">${esc(COLUMN_NAME)} · ${esc(volText)}</text>
  ${body}
  <text x="450" y="322" text-anchor="middle" font-size="21" fill="#ffffff" opacity="0.7" font-family="'Microsoft YaHei','PingFang SC',sans-serif">${esc(date)}　·　${Number(count) || 3} 篇</text>
</svg>`;
}

/**
 * 生成封面 PNG（2x = 1800×766）。
 * @param {string} date 期号日 YYYY-MM-DD（默认北京今天）
 * @param {string} outPath 输出路径
 * @param {{variant?: "daily"|"topic", title?: string, vol?: number, count?: number}} [opts]
 */
export async function renderCover(date, outPath, opts = {}) {
  const variant = opts.variant === "topic" ? "topic" : "daily";
  const svg = variant === "topic"
    ? topicSvg(date, opts.title || "", opts.vol, opts.count)
    : dailySvg(date);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}body{width:900px;height:383px;overflow:hidden}</style></head>
<body>
${svg}
</body></html>`;

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 383 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: 900, height: 383 } });
  await browser.close();
  return outPath;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? "" : argv[i + 1];
  };
  const hasFlags = argv.some((x) => x.startsWith("--"));
  const date = flag("--date") || (hasFlags ? businessToday() : (argv[0] || businessToday()));
  const variant = flag("--variant") || "daily";
  const out = resolve(flag("--out") || (hasFlags ? "assets/wechat-cover-topic.png" : (argv[1] || "assets/wechat-cover.png")));
  mkdirSync(dirname(out), { recursive: true });
  await renderCover(date, out, {
    variant,
    title: flag("--title"),
    vol: Number(flag("--vol")) || 1,
    count: Number(flag("--count")) || 3
  });
  console.log(`[wechat-cover] variant=${variant} date=${date} -> ${out} (1800x766)`);
}

// 仅 CLI 直跑时执行（被 publish-wechat-draft.mjs 导入时不执行——否则会用调用方的
// process.argv 当默认参数，曾把 .json 路径当截图输出导致 unsupported mime type）。
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
