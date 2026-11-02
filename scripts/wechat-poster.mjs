#!/usr/bin/env node
/**
 * wechat-poster.mjs —— 从期稿生成「贴图配套文字」（DESIGN-WECHAT-TRANS-COLUMN.md §7.5）
 *
 * 场景：贴图由系统生成（标题图 + 每篇文献的摘要图）。本脚本出一段图文对照的说明：
 *   一句话总述（这期讲什么）
 *   + 每篇一句话（这篇讲了什么）
 *   + 配图号（读者看图时知道是哪篇）
 *
 * 期稿 JSON：
 *   "poster": {
 *     "lead":  "动态运行包络要过四道关，四篇各占一道。",
 *     "items": ["公平不该只按有功算，无功也要参与", "…", "…", "…"]
 *   }
 *
 * 配图编号口径：**配图 N = 第 N 篇论文的摘要图**（不含标题图）。
 * items 数量必须与 papers 一致，少一条就错位——脚本会告警。
 *
 * 用法：
 *   node scripts/wechat-poster.mjs --in <期稿.json> [--out <file>]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { COLUMN_NAME } from "./wechat-column.config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const MAX_LEAD = 40;
const MAX_ITEM = 30;
const MAX_TOTAL_BASE = 200;   // 4 篇及以下
const MAX_TOTAL_PER_PAPER = 28; // 每多一篇放宽 28 字
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? "" : argv[i + 1]; };
const all = argv.includes("--all");
const inPath = flag("--in");

if (!all && !inPath) {
  console.error("用法: node scripts/wechat-poster.mjs --in <期稿.json> [--out <file>]\n      node scripts/wechat-poster.mjs --all   # 扫描 data/wechat-topics/*.json，批量生成");
  process.exit(2);
}

/** 批量：对该目录下所有含 papers 的期稿生成 .poster.txt。 */
if (all) {
  const dir = resolve(root, "data", "wechat-topics");
  const targets = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    // 只处理正式期稿 <date>-issue<NN>.json；排除选题单、样张、人工修改的中间版本
    .filter((f) => /^\d{4}-\d{2}-\d{2}-issue\w+\.json$/.test(f))
    .map((f) => resolve(dir, f))
    .filter((f) => {
      try { const j = JSON.parse(readFileSync(f, "utf8")); return Array.isArray(j.papers) && j.papers.length > 0; }
      catch { return false; }
    });

  if (!targets.length) { console.log("[poster] data/wechat-topics 下没有含 papers 的期稿"); process.exit(0); }

  let ok = 0;
  const warns = [];
  for (const f of targets) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--in", f], { encoding: "utf8" });
    const out = (r.stdout || "").trim().split("\n").pop();
    const w = (r.stderr || "").trim();
    if (r.status === 0) ok += 1;
    console.log(`· ${basename(f)} → ${out || (r.status === 0 ? "ok" : "失败")}`);
    if (w) warns.push(`${basename(f)}: ${w.split("\n").slice(-3).join(" / ")}`);
  }
  console.log(`\n[poster] 批量完成：${ok}/${targets.length} 个期稿`);
  if (warns.length) { console.error("[poster] 提示："); warns.forEach((x) => console.error("  ! " + x)); }
  process.exit(0);
}

const issue = JSON.parse(readFileSync(resolve(process.cwd(), inPath), "utf8"));
const papers = issue.papers || [];
const n = papers.length;
const transN = papers.filter((p) => /Transactions/.test(p.journal || "")).length;

const warn = [];
let poster = issue.poster;

if (!poster || !poster.lead || !Array.isArray(poster.items)) {
  warn.push("期稿缺 poster 字段，已用正文兜底——兜底版是摘要拼接，建议手写");
  poster = {
    lead: issue.topic || "",
    items: papers.map((p) => String(p.verdict || p.section || "").slice(0, MAX_ITEM))
  };
}

const lead = String(poster.lead).trim();
const items = poster.items.map((x) => String(x).trim()).filter(Boolean);

if (lead.length > MAX_LEAD) warn.push(`lead ${lead.length} 字，超过 ${MAX_LEAD}`);
if (items.length !== n) {
  warn.push(`items ${items.length} 条，与 papers ${n} 篇不一致——配图号会错位，必须一一对应`);
}
items.forEach((x, i) => {
  if (x.length > MAX_ITEM) warn.push(`items[${i}] ${x.length} 字，超过 ${MAX_ITEM}`);
});

const transPart = transN === n ? `${n} 篇 IEEE Trans`
  : transN ? `${n} 篇（${transN} 篇 IEEE Trans）`
  : `${n} 篇`;
const footer = `${COLUMN_NAME} Vol.${String(issue.vol || 1).padStart(3, "0")} · ${transPart}`;

const body = [
  lead,
  "",
  ...items.map((x, i) => `${CIRCLED[i] || i + 1} ${x}（配图 ${i + 1}）`),
  "",
  footer
].join("\n");

const plainLen = body.replace(/\s/g, "").length;
const maxTotal = Math.max(MAX_TOTAL_BASE, 80 + n * MAX_TOTAL_PER_PAPER);
if (plainLen > maxTotal) warn.push(`合计 ${plainLen} 字，超过上限 ${maxTotal}（${n} 篇）；建议每条再压 2–3 字`);

const outPath = flag("--out") || resolve(process.cwd(), inPath.replace(/\.json$/i, ".poster.txt"));
writeFileSync(outPath, body + "\n", "utf8");

console.log(body);
console.log(`\n— ${plainLen} 字 · 1 条总述 + ${items.length} 条分述 · 对应 ${n + 1} 张图 · 已写入 ${outPath}`);
if (warn.length) {
  console.error("\n[poster] 提示：");
  for (const w of warn) console.error("  ! " + w);
}
