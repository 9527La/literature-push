#!/usr/bin/env node
/**
 * Render the WeChat Official Account daily issue JSON into WeChat-safe HTML
 * (DESIGN-WECHAT-MP-DAILY.md, job: wechat-daily in RUNBOOK-AI-JOBS.md §A.3).
 *
 * The article body between the WECHAT-ARTICLE markers uses ONLY whitelisted
 * tags with fully inline styles — exactly what the mp.weixin.qq.com editor and
 * the draft/add API accept (no <a>, no <script>/<style> in the body, no
 * external resources, no position layouts). The template is the approved
 * mockup (DESIGN-MOCKUP-WECHAT-DAILY.html) converted 1:1.
 *
 * Hard validation (fails with a non-zero exit listing every violation):
 *   - briefs: 1-8 items, object ≤30 / method ≤40 / finding ≤50 chars (paperBriefs v2)
 *   - news: policy ≤3, general ≤5; every card needs title/summary/source
 *   - listing: count must equal items.length; direction keys whitelisted
 *   - digest ≤60 chars (forwarding-card summary, used by draft/add / L0 SOP)
 *
 * Usage:
 *   node scripts/wechat-render.mjs --in data/wechat-drafts/2026-10-08.json [--out <path>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIRECTIONS } from "../server/directions.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = {
  accent: "#3157d5",
  ink: "#171b24",
  body: "#525a68",
  muted: "#7d8592",
  line: "#e3e7ee",
  soft: "#f4f5f7",
  tint: "#eff3fa"
};
const FONT = "'Microsoft YaHei','PingFang SC',Arial,sans-serif";
const DIRECTION_LABELS = new Map(DIRECTIONS.filter((d) => d.key !== "other").map((d) => [d.key, d.label]));

function parseArgs(argv) {
  const args = { in: "", out: "" };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--in") args.in = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--out") args.out = resolve(process.cwd(), argv[i += 1]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.in) throw new Error("--in <issue.json> is required");
  if (!args.out) args.out = args.in.replace(/\.json$/i, ".html");
  if (args.out === args.in) throw new Error("--out must differ from --in");
  return args;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 内联 **加粗** → <strong>（转义后替换，避免引入注入面；与 mail.js 同约定）。 */
function inlineBold(value) {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${BRAND.ink}">$1</strong>`);
}

function plain(value, field, violations) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) violations.push(`${field} 不能为空`);
  return text;
}

function plainLen(value, field, max, violations) {
  const text = plain(value, field, violations);
  if (text.length > max) violations.push(`${field} 超长：${text.length} 字（上限 ${max}）`);
  return text;
}

/** 结构校验：返回清洗后的 issue；违规只记录不中断，最后统一汇报。 */
function validate(raw) {
  const violations = [];
  if (!raw || typeof raw !== "object") throw new Error("issue JSON 必须是对象");
  const issue = { version: 1, ...raw };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(issue.date || ""))) {
    violations.push(`date 必须是 YYYY-MM-DD，got: ${issue.date}`);
  }
  issue.digest = plainLen(issue.digest, "digest（转发卡片摘要）", 60, violations);

  // ── briefs（今日文献速评）──
  const briefs = Array.isArray(issue.briefs) ? issue.briefs : [];
  if (briefs.length < 1 || briefs.length > 8) {
    violations.push(`briefs 数量必须为 1-8，got: ${briefs.length}`);
  }
  issue.briefs = briefs.map((brief, index) => {
    const tag = `briefs[${index}]`;
    const item = {
      title: plain(brief?.title, `${tag}.title`, violations),
      journal: plain(brief?.journal, `${tag}.journal`, violations),
      direction: brief?.direction == null ? null : String(brief.direction),
      object: plainLen(brief?.object, `${tag}.object（研究对象）`, 30, violations),
      method: plainLen(brief?.method, `${tag}.method（研究方法）`, 40, violations),
      finding: plainLen(brief?.finding, `${tag}.finding（核心结论）`, 50, violations)
    };
    if (item.direction && !DIRECTION_LABELS.has(item.direction)) {
      violations.push(`${tag}.direction 非白名单 key：${item.direction}`);
    }
    return item;
  });

  // ── news（每日资讯）──
  const news = issue.news && typeof issue.news === "object" ? issue.news : {};
  const cleanCards = (cards, tag, max) => {
    const list = Array.isArray(cards) ? cards : [];
    if (list.length > max) violations.push(`${tag} 数量 ${list.length} 超上限 ${max}`);
    return list.slice(0, max).map((card, index) => ({
      title: plain(card?.title, `${tag}[${index}].title`, violations),
      summary: plain(card?.summary, `${tag}[${index}].summary`, violations),
      source: plain(card?.source, `${tag}[${index}].source`, violations)
    }));
  };
  issue.news = {
    policy: cleanCards(news.policy, "news.policy", 3),
    general: cleanCards(news.general, "news.general", 5)
  };

  // ── listing（今日新入库文献清单）──
  const listing = Array.isArray(issue.listing) ? issue.listing : [];
  issue.listing = listing.map((group, index) => {
    const tag = `listing[${index}]`;
    const key = group?.key == null ? null : String(group.key);
    if (key && !DIRECTION_LABELS.has(key)) {
      violations.push(`${tag}.key 非白名单 key：${key}`);
    }
    const items = Array.isArray(group?.items) ? group.items : [];
    if (Number(group?.count) !== items.length) {
      violations.push(`${tag}.count（${group?.count}）与 items 数量（${items.length}）不一致`);
    }
    return {
      key,
      label: key ? DIRECTION_LABELS.get(key) : "暂未分类",
      count: items.length,
      items: items.map((item, itemIndex) => ({
        title: plain(item?.title, `${tag}.items[${itemIndex}].title`, violations),
        journal: plain(item?.journal, `${tag}.items[${itemIndex}].journal`, violations)
      }))
    };
  });

  issue.siteUrl = String(issue.siteUrl || "").trim();
  return { issue, violations };
}

// ── 模板片段（与 DESIGN-MOCKUP-WECHAT-DAILY.html 1:1，全内联样式）──────────

const css = (obj) => Object.entries(obj).map(([k, v]) => `${k}:${v}`).join(";");

const H2_STYLE = css({
  margin: "26px 0 12px", "padding-left": "9px", "border-left": `3px solid ${BRAND.accent}`,
  "font-size": "17px", "font-weight": "700", color: BRAND.ink, "line-height": "1.4"
});

function renderIntro(issue) {
  if (!issue.intro) return "";
  return `<section style="margin:0 0 22px;padding:12px 14px;background:${BRAND.tint};border-radius:8px">
<p style="margin:0 0 6px;font-size:14px;font-weight:700;color:${BRAND.accent}">今日导读</p>
<p style="margin:0;font-size:14px;color:${BRAND.body};line-height:1.8">${inlineBold(issue.intro)}</p>
</section>`;
}

function renderNewsCard(card, last) {
  return `<section style="margin:0 0 ${last ? 18 : 12}px;padding:11px 13px;background:${BRAND.soft};border-radius:8px">
<p style="margin:0 0 4px;font-size:15px;font-weight:600;color:${BRAND.ink};line-height:1.6">${escapeHtml(card.title)}</p>
<p style="margin:0 0 4px;font-size:14px;color:${BRAND.body};line-height:1.7">${inlineBold(card.summary)}</p>
<p style="margin:0;font-size:12px;color:${BRAND.muted}">来源：${escapeHtml(card.source)}</p>
</section>`;
}

function renderNews(issue) {
  const { policy, general } = issue.news;
  if (!policy.length && !general.length) return "";
  const policyCards = policy.map((card, i) => renderNewsCard(card, i === policy.length - 1 && !general.length));
  const generalCards = general.map((card, i) => renderNewsCard(card, i === general.length - 1));
  return `<h2 style="${H2_STYLE}">每日资讯</h2>
${policyCards.join("\n")}${policyCards.length && generalCards.length ? "\n" : ""}${generalCards.join("\n")}`;
}

function renderBriefField(label, text, last) {
  return `<section style="margin:0 0 ${last ? 0 : 6}px;padding:8px 11px;background:${BRAND.soft};border-radius:6px">
<p style="margin:0;font-size:14px;color:${BRAND.body};line-height:1.75"><span style="color:${BRAND.accent};font-weight:700">${label}</span>｜${escapeHtml(text)}</p>
</section>`;
}

function renderBrief(brief, last) {
  const meta = [brief.journal, brief.direction ? DIRECTION_LABELS.get(brief.direction) : ""]
    .filter(Boolean).join(" · ");
  return `<section style="margin:0 0 ${last ? 18 : 14}px;padding:13px 14px;border:1px solid ${BRAND.line};border-radius:8px">
<p style="margin:0 0 6px;font-size:15px;font-weight:700;color:${BRAND.ink};line-height:1.6">${escapeHtml(brief.title)}</p>
<p style="margin:0 0 10px;font-size:12px;color:${BRAND.muted}">${escapeHtml(meta)}</p>
${renderBriefField("研究对象", brief.object, false)}
${renderBriefField("研究方法", brief.method, false)}
${renderBriefField("核心结论", brief.finding, true)}
</section>`;
}

function renderBriefs(issue) {
  if (!issue.briefs.length) return "";
  return `<h2 style="${H2_STYLE}">今日文献速评</h2>
${issue.briefs.map((brief, i) => renderBrief(brief, i === issue.briefs.length - 1)).join("\n")}`;
}

function renderListing(issue) {
  const groups = issue.listing.filter((group) => group.items.length);
  if (!groups.length) return "";
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  // 不用 <ul>/<li>：微信对 API 提交的 HTML 中 li 之间的空白会拆出幽灵列表项
  // （实测 2026-10-08），改用文字圆点 + 段落自绘，行为确定。
  const body = groups.map((group, index) => {
    const paras = group.items.map((item) => `<p style="margin:0 0 6px;font-size:14px;color:${BRAND.body};line-height:1.7">• ${escapeHtml(item.title)} — <span style="color:${BRAND.muted}">${escapeHtml(item.journal)}</span></p>`);
    return `<h3 style="margin:${index === 0 ? 0 : 14}px 0 8px;font-size:14px;font-weight:700;color:${BRAND.accent}">${escapeHtml(group.label)} · ${group.count} 篇</h3>
${paras.join("\n")}`;
  }).join("\n");
  return `<h2 style="${H2_STYLE}">今日新入库文献（${total} 篇）</h2>
${body}`;
}

function renderFooter(issue) {
  const site = issue.siteUrl
    ? `<p style="margin:0 0 6px;font-size:12px;color:${BRAND.muted};line-height:1.7">今日资讯完整版（含全部原文链接）与文献库请访问：<span style="color:${BRAND.accent};font-weight:600">${escapeHtml(issue.siteUrl)}</span>，或点击「阅读原文」直达。</p>`
    : "";
  return `<hr style="border:0;border-top:1px solid ${BRAND.line};margin:20px 0" />
<p style="margin:0 0 6px;font-size:12px;color:${BRAND.muted};line-height:1.7">本文由 AI 辅助创作，速评与摘要可能存在错误或幻觉，重要信息请以论文原文及官方发布为准。</p>
<p style="margin:0;font-size:12px;color:${BRAND.muted};line-height:1.7">内容基于公开学术论文整理，仅用于学习交流。</p>${site ? `\n${site}` : ""}`;
}

function renderArticle(issue) {
  // 正文不含 H1/账号行：微信文章页自动渲染标题与作者（重复会双标题，实测 2026-10-08）。
  // 末尾紧凑化：去除标签间所有换行/空白——微信对空白节点的解析在列表等场景会产生
  // 幽灵元素（实测 2026-10-08），纯块级内联样式的 HTML 压成单行最稳。
  const raw = `<section style="padding:20px 18px 28px;font-family:${FONT}">
${renderIntro(issue)}
${renderNews(issue)}
${renderBriefs(issue)}
${renderListing(issue)}
${renderFooter(issue)}
</section>`;
  return raw.replace(/\n+/g, "").replace(/>\s+</g, "><");
}

function main() {
  const args = parseArgs(process.argv);
  const raw = JSON.parse(readFileSync(args.in, "utf8"));
  const { issue, violations } = validate(raw);
  if (violations.length) {
    console.error(`[wechat-render] 校验失败，共 ${violations.length} 处违规：`);
    for (const violation of violations) console.error(`  ✗ ${violation}`);
    process.exit(1);
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="wechat-issue-digest" content="${escapeHtml(issue.digest)}" />
<title>电研新视界 日报｜${escapeHtml(issue.date)}</title>
<!-- 正文即发布内容：L0 全选复制 <body> 内标记之间的部分；摘要见 meta 与 issue JSON -->
<style>body { margin: 0; background: #ffffff; }</style>
</head>
<body>
<!-- WECHAT-ARTICLE-START -->
${renderArticle(issue)}
<!-- WECHAT-ARTICLE-END -->
</body>
</html>
`;
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, html, "utf8");
  const briefTotal = issue.listing.reduce((sum, group) => sum + group.count, 0);
  console.log(`[wechat-render] out=${args.out}`);
  console.log(`[wechat-render] briefs=${issue.briefs.length} news=${issue.news.policy.length + issue.news.general.length} listing=${briefTotal} digest=${issue.digest.length} 字`);
}

main();
