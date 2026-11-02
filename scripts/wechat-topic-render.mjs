#!/usr/bin/env node
/**
 * wechat-topic-render.mjs —— 专题期稿 → 公众号受限 HTML（DESIGN-WECHAT-TRANS-COLUMN.md v3）
 *
 * 与 wechat-render.mjs（日报）的区别：
 *   · 允许 <img>（专题必须带摘要图），src 只接受本地 data/figures/*.png 或 https://mmbiz.qpic.cn/
 *   · 单篇 5 段固定结构：一句话判断 / 摘要图 / 核心创新点 / 技术路线 / 边界与启示
 *   · 创新点与技路线来自期稿 JSON，渲染时原样输出，不做改写
 *
 * 用法：
 *   node scripts/wechat-topic-render.mjs --in data/wechat-topics/2026-10-28-issue02.json [--out <path>]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COLUMN_NAME } from "./wechat-column.config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = {
  accent: "#c96442", ink: "#191919", body: "#252525", muted: "#8f8b83",
  line: "#d8d4c8", page: "#f7f5f0", card: "#ebe4d4", head: "#f2eee3",
  chipBg: "#fdfcfa", chipBd: "#d1cfcc", soft: "#fbfaf6"
};
const FONT = "'Microsoft YaHei','PingFang SC',Arial,sans-serif";
const MAX_PAPERS = 12;

function parseArgs(argv) {
  const args = { in: "", out: "" };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--in") args.in = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--out") args.out = resolve(process.cwd(), argv[i += 1]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.in) throw new Error("--in <issue.json> is required");
  if (!args.out) args.out = args.in.replace(/\.json$/i, ".html");
  return args;
}

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** 创新点 points 里允许 <b>，其余一律转义；先转义再还原 <b>。 */
function richText(v) {
  return esc(v).replace(/&lt;b&gt;/g, `<strong style="color:${BRAND.ink}">`)
    .replace(/&lt;\/b&gt;/g, "</strong>");
}

function validate(issue) {
  const v = [];
  if (!issue || typeof issue !== "object") throw new Error("期稿必须是对象");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(issue.date || ""))) v.push(`date 非法：${issue.date}`);
  if (!issue.topic) v.push("topic 为空");
  if (!issue.lead || issue.lead.length < 40) v.push("lead 少于 40 字");
  if (String(issue.digest || "").length > 60) v.push(`digest 超 60 字（${issue.digest.length}）`);

  const papers = Array.isArray(issue.papers) ? issue.papers : [];
  if (!papers.length) v.push("papers 为空");
  if (papers.length > MAX_PAPERS) v.push(`papers 超过 ${MAX_PAPERS} 篇`);

  papers.forEach((p, i) => {
    const tag = `papers[${i}]`;
    if (!p.section) v.push(`${tag}.section 缺失`);
    if (!p.titleZh) v.push(`${tag}.titleZh 缺失`);
    if (!p.verdict) v.push(`${tag}.verdict 缺失`);
    else if (p.verdict.length > 45) v.push(`${tag}.verdict 超 45 字（${p.verdict.length}）`);
    if (!Array.isArray(p.innovations) || !p.innovations.length) v.push(`${tag}.innovations 为空`);
    if (!p.method || !p.method.object) v.push(`${tag}.method 不完整`);
    if (!Array.isArray(p.limits) || !p.limits.length) v.push(`${tag}.limits 为空`);

    const src = p.figure?.path || "";
    if (src) {
      const okRemote = /^https:\/\/mmbiz\.qpic\.cn\//.test(src);
      const okLocal = existsSync(resolve(root, src));
      if (!okRemote && !okLocal) v.push(`${tag}.figure 路径不存在：${src}`);
    }
  });
  return v;
}

const H2 = (t) => `<p style="margin:26px 0 10px;text-align:center"><span style="display:inline-block;font-weight:700;font-size:16px;color:${BRAND.ink};border-bottom:2px solid ${BRAND.accent};padding:0 2px 4px">${esc(t)}</span></p>`;
const SUB = (t) => `<p style="margin:20px 0 8px"><span style="font-weight:700;font-size:14px;color:${BRAND.ink};border-bottom:2px solid ${BRAND.accent};padding:0 2px 3px">${esc(t)}</span></p>`;
const HR = `<hr style="border:0;border-top:1px dashed #b8b8b8;margin:18px 10px 14px" />`;

function renderHeader(issue) {
  const toc = issue.papers.map((p, i) =>
    `<p style="margin:5px 0;font-size:14px;color:${BRAND.ink};line-height:1.8"><span style="color:${BRAND.accent};font-weight:700">0${i + 1}</span>　${esc(p.section.replace(/^0\d\s*/, ""))}</p>`
  ).join("");
  return `<section style="margin:0 0 18px;padding:16px 15px 14px;background:${BRAND.head};border-radius:12px">
<p style="margin:0 0 6px;text-align:center"><span style="font-size:13px;color:${BRAND.accent};letter-spacing:0.22em;font-weight:700">${esc(COLUMN_NAME)}</span></p>
<p style="margin:0 0 2px;text-align:center;font-size:12px;color:${BRAND.muted};letter-spacing:0.1em">Vol.${String(issue.vol).padStart(3, "0")}　·　${esc(issue.date)}</p>
<p style="margin:10px 0 4px;text-align:center;font-size:16px;font-weight:700;color:${BRAND.ink};line-height:1.5">${esc(issue.topic)}</p>
<p style="margin:0 0 12px;text-align:center;font-size:12px;color:${BRAND.muted}">本期 ${issue.papers.length} 篇 · 近 30 天入库文献</p>
<p style="margin:12px 0 6px"><span style="font-weight:700;font-size:13px;color:${BRAND.ink};border-bottom:2px solid ${BRAND.accent};padding:0 2px 3px">本期篇目</span></p>
${toc}
</section>`;
}

function renderPaper(p, last) {
  const innov = p.innovations.map((inn, i) => {
    const pts = (inn.points || []).map((x) =>
      `<p style="margin:0 0 3px;font-size:13px;color:${BRAND.body};line-height:1.75">· ${richText(x)}</p>`).join("");
    const val = inn.value
      ? `<p style="margin:0;font-size:13px;color:${BRAND.accent};line-height:1.75">价值：${richText(inn.value)}</p>` : "";
    return `<section style="margin:0 0 8px;padding:9px 11px;background:${BRAND.chipBg};border:0.5px solid ${BRAND.chipBd};border-radius:6px">
<p style="margin:0 0 4px;font-size:14px;font-weight:700;color:${BRAND.ink};line-height:1.6">${"①②③④⑤"[i] || i + 1} ${richText(inn.title)}</p>
${pts}${val}
</section>`;
  }).join("");

  const cell = (label, text) =>
    `<span style="display:inline-block;width:48.5%;box-sizing:border-box;padding:8px 10px;background:${BRAND.soft};border:0.5px solid ${BRAND.chipBd};border-radius:6px;font-size:13px;line-height:1.7;color:${BRAND.body};vertical-align:top"><span style="color:${BRAND.accent};font-weight:700">${label}</span>｜${esc(text || "—")}</span>`;
  const m = p.method;
  const grid = `<p style="margin:0 0 6px;font-size:0;line-height:0">${cell("对象", m.object)}<span style="display:inline-block;width:1.5%"></span>${cell("理论", m.theory)}</p>
<p style="margin:0 0 10px;font-size:0;line-height:0">${cell("控制", m.control)}<span style="display:inline-block;width:1.5%"></span>${cell("验证", m.validation)}</p>`;

  const limits = p.limits.map((x) =>
    `<p style="margin:0 0 3px;font-size:13px;color:${BRAND.body};line-height:1.75">· ${esc(x)}</p>`).join("");
  const take = p.takeaway
    ? `<section style="margin:0 0 12px;padding:9px 11px;background:${BRAND.soft};border-left:2px solid ${BRAND.accent};border-radius:0 6px 6px 0">
<p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${BRAND.accent};letter-spacing:0.06em">可迁移</p>
<p style="margin:0;font-size:13px;color:${BRAND.body};line-height:1.75">· ${esc(p.takeaway)}</p></section>` : "";

  const fig = p.figure?.path
    ? `<p style="margin:0 0 6px"><img src="${esc(p.figure.path)}" style="width:100%;display:block;border-radius:6px;border:0.5px solid #e2ded4" /></p>
<p style="margin:0 0 12px;font-size:11px;color:${BRAND.muted};line-height:1.6;text-align:center">${esc(p.figure.caption || "图源：原文")}</p>` : "";

  return `${H2(p.section)}
<p style="margin:14px 0 2px;font-size:17px;font-weight:700;color:${BRAND.ink};line-height:1.5">${esc(p.titleZh)}</p>
<p style="margin:0 0 6px;font-size:12px;color:${BRAND.muted};line-height:1.6;font-style:italic">${esc(p.titleEn)}</p>
<p style="margin:0 0 12px;font-size:12px;color:${BRAND.muted};line-height:1.7">${esc(p.journal)} · ${esc(p.meta)}<br />DOI: ${esc(p.doi)}</p>
<section style="margin:0 0 12px;padding:10px 12px;background:${BRAND.head};border-radius:8px">
<p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${BRAND.accent};letter-spacing:0.06em">一句话判断</p>
<p style="margin:0;font-size:14px;color:${BRAND.body};line-height:1.8">${esc(p.verdict)}</p>
</section>
${fig}${SUB("核心创新点")}
${innov}${SUB("技术路线")}
${grid}${SUB("边界与启示")}
<section style="margin:0 0 8px;padding:9px 11px;background:${BRAND.soft};border-left:2px solid #b8b8b8;border-radius:0 6px 6px 0">
<p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${BRAND.muted};letter-spacing:0.06em">局限</p>
${limits}</section>
${take}${last ? "" : HR}`;
}

function renderFooter() {
  return `<hr style="border:0;border-top:1px dashed ${BRAND.line};margin:20px 0 10px" />
<p style="margin:0 0 6px;font-size:12px;color:${BRAND.muted};line-height:1.7">本文由 AI 辅助创作，创新点与解析可能存在错误或幻觉，重要结论请以论文原文为准。</p>
<p style="margin:0;font-size:12px;color:${BRAND.muted};line-height:1.7">文中配图引自原论文，版权归原作者与出版方所有，仅用于学术评述。</p>`;
}

function main() {
  const args = parseArgs(process.argv);
  const issue = JSON.parse(readFileSync(args.in, "utf8"));
  const violations = validate(issue);
  if (violations.length) {
    console.error(`[topic-render] 校验失败，共 ${violations.length} 处：`);
    for (const x of violations) console.error("  ✗ " + x);
    process.exit(1);
  }
  const body = `<section style="padding:20px 18px 28px;background:${BRAND.page};font-family:${FONT}">
${renderHeader(issue)}
<section style="margin:0 0 20px;padding:12px 14px;background:${BRAND.soft};border-left:3px solid ${BRAND.accent};border-radius:0 8px 8px 0">
<p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${BRAND.accent};letter-spacing:0.06em">专题导语</p>
<p style="margin:0;font-size:14px;color:${BRAND.body};line-height:1.85">${esc(issue.lead)}</p>
</section>
${issue.papers.map((p, i) => renderPaper(p, i === issue.papers.length - 1)).join("\n")}
${renderFooter()}
</section>`.replace(/\n+/g, "").replace(/>\s+</g, "><");

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="wechat-issue-digest" content="${esc(issue.digest)}" />
<title>${esc(COLUMN_NAME)} Vol.${issue.vol}｜${esc(issue.topic)}</title>
<style>body { margin: 0; background: #ffffff; }</style>
</head>
<body>
<!-- WECHAT-ARTICLE-START -->
${body}
<!-- WECHAT-ARTICLE-END -->
</body>
</html>
`;
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, html, "utf8");
  const chars = issue.lead.length + issue.papers.reduce((s, p) =>
    s + p.verdict.length + p.limits.join("").length + (p.takeaway || "").length
    + p.innovations.reduce((t, i) => t + i.title.length + (i.points || []).join("").length + (i.value || "").length, 0), 0);
  console.log(`[topic-render] out=${args.out}`);
  console.log(`[topic-render] papers=${issue.papers.length} 正文字数≈${chars} digest=${issue.digest.length} 字`);
}

main();
