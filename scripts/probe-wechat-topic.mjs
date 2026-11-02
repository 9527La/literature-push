#!/usr/bin/env node
/**
 * probe-wechat-topic.mjs —— 专题期稿 HTML 的微信兼容性探针（DESIGN v3 M3）
 *
 * 与 probe-wechat-html.mjs（日报）的区别：允许 <img>，但 src 必须是
 *   · 本地 data/figures/*.png（L0 预览用），或
 *   · https://mmbiz.qpic.cn/...（L1 上传后由 upload-wechat-image.mjs 回写）
 * 其余规则同日报：白名单标签、全内联样式、无 script/style/link/iframe/a、无 position/url()。
 *
 * 用法：node scripts/probe-wechat-topic.mjs --in <issue.html> [--issue <issue.json>]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WHITELIST = new Set(["section", "p", "span", "strong", "em", "b", "h2", "h3", "h4", "ul", "ol", "li", "hr", "br", "img"]);
const FORBIDDEN = new Set(["a", "script", "style", "link", "iframe", "video", "svg", "form"]);
const BAD_STYLE = [/position\s*:/i, /url\s*\(/i, /@import/i, /expression\s*\(/i, /javascript\s*:/i];

function args() {
  const a = { in: "", issue: "" };
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === "--in") a.in = resolve(process.cwd(), process.argv[i += 1]);
    else if (process.argv[i] === "--issue") a.issue = resolve(process.cwd(), process.argv[i += 1]);
    else throw new Error("Unknown argument: " + process.argv[i]);
  }
  if (!a.in) throw new Error("--in <issue.html> is required");
  return a;
}

function body(html) {
  const s = html.indexOf("<!-- WECHAT-ARTICLE-START");
  const e = html.indexOf("<!-- WECHAT-ARTICLE-END");
  return s !== -1 && e > s ? html.slice(s, e) : html;
}

function main() {
  const a = args();
  const html = readFileSync(a.in, "utf8");
  const art = body(html);
  const v = [];

  const tagRe = /<\s*([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;
  let m;
  let imgs = 0;
  while ((m = tagRe.exec(art))) {
    const name = m[1].toLowerCase();
    const attrs = m[2] || "";
    if (FORBIDDEN.has(name)) v.push(`禁用标签 <${name}>`);
    else if (!WHITELIST.has(name)) v.push(`非白名单标签 <${name}>`);
    if (name === "img") {
      imgs += 1;
      const src = (attrs.match(/src="([^"]*)"/) || [])[1] || "";
      if (!/^(data\/figures\/[\w.-]+\.png|https:\/\/mmbiz\.qpic\.cn\/)/.test(src)) {
        v.push(`img src 不在白名单：${src.slice(0, 60)}`);
      }
      if (!/style="/.test(attrs)) v.push("img 缺内联 style");
    } else if (name !== "br" && name !== "hr" && !/style="/.test(attrs)) {
      v.push(`<${name}> 缺内联 style`);
    }
    const style = (attrs.match(/style="([^"]*)"/) || [])[1] || "";
    for (const re of BAD_STYLE) if (re.test(style)) v.push(`style 命中禁用模式 ${re}：${style.slice(0, 50)}`);
    if (/\b(class|id|href)=/.test(attrs)) v.push(`出现 class/id/href 属性：<${name}>`);
  }

  const need = ["一句话判断", "核心创新点", "技术路线", "边界与启示", "局限", "专题导语"];
  for (const k of need) if (!art.includes(k)) v.push(`缺区块：${k}`);
  if (!art.includes("本文由 AI 辅助创作")) v.push("缺 AI 声明");
  if (!art.includes("版权归原作者")) v.push("缺图片版权声明");

  if (a.issue) {
    const issue = JSON.parse(readFileSync(a.issue, "utf8"));
    const n = (art.match(/一句话判断/g) || []).length;
    if (n !== issue.papers.length) v.push(`一句话判断 ${n} 处，应为 ${issue.papers.length} 篇`);
    if (imgs !== issue.papers.filter((p) => p.figure?.path).length) {
      v.push(`img ${imgs} 张，与有配图篇数不一致`);
    }
    for (const p of issue.papers) {
      if (!art.includes(p.titleZh)) v.push(`正文缺标题：${p.titleZh.slice(0, 20)}`);
      for (const inn of p.innovations) {
        if (!art.includes(inn.title)) v.push(`创新点未逐字出现：${inn.title.slice(0, 20)}`);
      }
    }
  }

  if (v.length) {
    console.error(`[probe-topic] ${v.length} 处违规：`);
    for (const x of v) console.error("  ✗ " + x);
    process.exit(1);
  }
  console.log(`[probe-topic] 通过 · 图片 ${imgs} 张 · 标签/样式/结构/复用一致性 全部合规`);
}

main();
