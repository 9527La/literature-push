#!/usr/bin/env node
/**
 * Acceptance probe for the WeChat daily issue HTML (DESIGN-WECHAT-MP-DAILY.md
 * M1 + M2). Validates the article body between the WECHAT-ARTICLE markers:
 *
 * M1 — WeChat-safe markup:
 *   · tag whitelist: section/p/span/strong/em/h1-h4/ul/ol/li/hr/br only
 *   · forbidden: <a> <script> <style> <img> <link> <iframe>
 *   · every open tag carries a style attribute (fully inline), and the style
 *     value contains no position / url( / @import / expression / javascript:
 *   · no class= / id= / href= / src= anywhere in the body
 *
 * M2 — content cross-check against the issue JSON (when provided):
 *   · headline contains the brand + issue date; AI & disclaimer lines present
 *   · briefs render 3 fields each (研究对象/研究方法/核心结论)
 *   · news card count and listing total match the JSON
 *   · digest (forwarding-card summary) ≤60 chars
 *
 * Exit 0 = zero violations; exit 1 prints every violation.
 *
 * Usage:
 *   node scripts/probe-wechat-html.mjs --in data/wechat-drafts/2026-10-08.html [--issue <json>]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const args = { in: "", issue: "" };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--in") args.in = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--issue") args.issue = resolve(process.cwd(), argv[i += 1]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.in) throw new Error("--in <issue.html> is required");
  return args;
}

const TAG_WHITELIST = new Set(["section", "p", "span", "strong", "em", "h1", "h2", "h3", "h4", "ul", "ol", "li", "hr", "br"]);
const FORBIDDEN_TAGS = new Set(["a", "script", "style", "img", "link", "iframe"]);
const FORBIDDEN_STYLE = [/position\s*:/i, /url\s*\(/i, /@import/i, /expression\s*\(/i, /javascript\s*:/i];

/** 提取正文区块（标记之间），没有标记时退回整个文档。 */
function articleBody(html) {
  const start = html.indexOf("<!-- WECHAT-ARTICLE-START");
  const end = html.indexOf("<!-- WECHAT-ARTICLE-END");
  if (start !== -1 && end !== -1 && end > start) return html.slice(start, end);
  return html;
}

/** 非贪婪匹配标签，支持属性值里带 > 吗？内联样式不含 >，简单正则足够。 */
function* tagMatches(html) {
  const re = /<\s*([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;
  let match;
  while ((match = re.exec(html))) {
    yield { name: match[1].toLowerCase(), attrs: match[2] || "", selfClose: match[3] === "/", index: match.index };
  }
}

function probeM1(body, violations) {
  let tagCount = 0;
  for (const tag of tagMatches(body)) {
    tagCount += 1;
    if (FORBIDDEN_TAGS.has(tag.name)) {
      violations.push(`M1 禁用标签 <${tag.name}> @offset ${tag.index}`);
      continue;
    }
    if (!TAG_WHITELIST.has(tag.name)) {
      violations.push(`M1 非白名单标签 <${tag.name}> @offset ${tag.index}`);
      continue;
    }
    if (tag.selfClose) continue;
    if (!/(?:^|\s)style\s*=/i.test(tag.attrs)) {
      violations.push(`M1 <${tag.name}> 缺少内联 style @offset ${tag.index}`);
    }
    if (/(?:^|\s)(class|id|href|src)\s*=/i.test(tag.attrs)) {
      violations.push(`M1 <${tag.name}> 携带 class/id/href/src 属性 @offset ${tag.index}`);
    }
    const style = tag.attrs.match(/style\s*=\s*"([^"]*)"/i);
    if (style) {
      for (const pattern of FORBIDDEN_STYLE) {
        if (pattern.test(style[1])) {
          violations.push(`M1 <${tag.name}> style 含禁用声明（${pattern}）@offset ${tag.index}`);
        }
      }
    }
  }
  if (tagCount === 0) violations.push("M1 正文区块未解析到任何标签（标记缺失或正文为空）");
  // 标签外的裸文本不允许出现原始 <（转义残缺）
  const stripped = body.replace(/<\s*(?:"[^"]*"|'[^']*'|[^>"'])*>/g, "");
  if (/<[a-zA-Z/]/.test(stripped)) violations.push("M1 标签外存在未转义的 <（疑似标签残缺）");
  return tagCount;
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function probeM2(body, html, issue, violations) {
  if (!issue) return;
  const date = String(issue.date || "");
  // 标题由微信文章页自动渲染：正文不得重复（否则双标题），正确性看 <title>。
  const titleTag = html.match(/<title>([^<]*)<\/title>/);
  if (!titleTag || decodeEntities(titleTag[1]) !== `电研新视界 日报｜${date}`) {
    violations.push(`M2 <title> 应为「电研新视界 日报｜${date}」，got: ${titleTag ? decodeEntities(titleTag[1]) : "缺失"}`);
  }
  if (body.includes(`电研新视界 日报｜${date}`)) {
    violations.push("M2 正文重复了文章标题（微信会自动渲染标题，正文应从「今日导读」开始）");
  }
  if (!body.includes("今日导读") && (issue.news?.policy?.length || issue.news?.general?.length || issue.briefs?.length)) {
    violations.push("M2 正文缺少「今日导读」起始块");
  }
  if (!body.includes("本文由 AI 辅助创作")) violations.push("M2 缺少 AI 辅助创作声明");
  if (!body.includes("幻觉")) violations.push("M2 缺少幻觉免责声明");
  if (!body.includes("阅读原文") || !body.includes("文献库")) {
    violations.push("M2 文末缺少网站引导（应含「阅读原文」与「文献库」字样）");
  }

  const briefs = Array.isArray(issue.briefs) ? issue.briefs : [];
  const fields = ["研究对象", "研究方法", "核心结论"];
  for (const field of fields) {
    const n = countOccurrences(body, `>${field}</span>`);
    if (n !== briefs.length) {
      violations.push(`M2 「${field}」出现 ${n} 次，与 briefs 数量 ${briefs.length} 不一致`);
    }
  }
  if (briefs.length && !body.includes("今日文献速评")) violations.push("M2 有速评但缺少「今日文献速评」板块标题");

  const news = issue.news || {};
  const newsTotal = (news.policy?.length || 0) + (news.general?.length || 0);
  const renderedNews = countOccurrences(body, "来源：");
  if (renderedNews !== newsTotal) {
    violations.push(`M2 资讯卡（来源：）出现 ${renderedNews} 次，与 news 数量 ${newsTotal} 不一致`);
  }
  if (newsTotal && !body.includes("每日资讯")) violations.push("M2 有资讯但缺少「每日资讯」板块标题");

  const listingTotal = (issue.listing || []).reduce((sum, group) => sum + (group.items?.length || 0), 0);
  if (listingTotal > 0) {
    const m = body.match(/今日新入库文献（(\d+) 篇）/);
    if (!m) violations.push("M2 缺少「今日新入库文献（N 篇）」板块标题");
    else if (Number(m[1]) !== listingTotal) {
      violations.push(`M2 清单总数 ${m[1]} 与 issue JSON 合计 ${listingTotal} 不一致`);
    }
  }

  const digestMeta = html.match(/<meta name="wechat-issue-digest" content="([^"]*)"/);
  const digest = digestMeta ? decodeEntities(digestMeta[1]) : String(issue.digest || "");
  if (!digest) violations.push("M2 缺少转发卡片摘要（digest）");
  else if (digest.length > 60) violations.push(`M2 digest 超长：${digest.length} 字（上限 60）`);
}

function decodeEntities(text) {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function main() {
  const args = parseArgs(process.argv);
  const html = readFileSync(args.in, "utf8");
  const issue = args.issue ? JSON.parse(readFileSync(args.issue, "utf8")) : null;
  const body = articleBody(html);

  const violations = [];
  const tagCount = probeM1(body, violations);
  probeM2(body, html, issue, violations);

  if (violations.length) {
    console.error(`[probe-wechat-html] ✗ ${args.in}：${violations.length} 处违规（解析标签 ${tagCount} 个）`);
    for (const violation of violations) console.error(`  ✗ ${violation}`);
    process.exit(1);
  }
  console.log(`[probe-wechat-html] ✓ ${args.in}：M1+M2 全部通过（正文标签 ${tagCount} 个，0 违规）`);
}

main();
