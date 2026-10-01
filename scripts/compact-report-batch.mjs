#!/usr/bin/env node
/**
 * Compact view of an export-report-batch payload: per-direction digest with
 * title / journal / keywords / short abstract head for every article, plus a
 * keyword frequency aggregate. Used by the report agent to review large
 * backfill batches (monthly = 1000+ articles) without paging the raw JSON.
 *
 * Usage:
 *   node scripts/compact-report-batch.mjs --file <batch.json> [--abstract 120] [--out <path>]
 */
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DIRECTIONS } from "../server/directions.js";

function parseArgs(argv) {
  const args = { file: "", abstract: 120, out: "" };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--file") args.file = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--abstract") args.abstract = Number(argv[i += 1]);
    else if (argv[i] === "--out") args.out = resolve(process.cwd(), argv[i += 1]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.file) throw new Error("--file <batch.json> is required");
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const batch = JSON.parse(readFileSync(args.file, "utf8"));
  const labelByKey = new Map(DIRECTIONS.map((d) => [d.key, d.label]));
  const groups = new Map();
  for (const article of batch.articles) {
    const key = article.direction || "unclassified";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(article);
  }
  const lines = [];
  const reuseTotal = batch.articles.filter((a) => a.priorBrief).length;
  lines.push(`# 素材压缩视图 ${batch.periodStart} ~ ${batch.periodEnd}（${batch.kind}）`);
  lines.push(`total=${batch.stats.total} prev=${batch.stats.previous.total} unclassified=${batch.stats.unclassified ?? "?"} 可复用速评=${reuseTotal}/${batch.articles.length} 篇`);
  lines.push(`⚠ 带 ⟳ 的文献已有周报速评（priorBrief），写作时逐字复用、禁止改写；仅对无 ⟳ 的文献新写速评。`);
  lines.push(`本期分布：${Object.entries(batch.stats.directionCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(" ")}`);
  lines.push(`上期分布：${Object.entries(batch.stats.previous.directionCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(" ") || "(无)"}`);
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [key, articles] of ordered) {
    lines.push("");
    lines.push(`## ${key === "unclassified" ? "未分类" : (labelByKey.get(key) || key)}（${articles.length} 篇）`);
    const keywordFreq = new Map();
    for (const article of articles) {
      const head = String(article.abstract || "").replace(/\s+/g, " ").slice(0, args.abstract);
      const brief = article.priorBrief
        ? ` ｜⟳对象:${article.priorBrief.object}｜方法:${article.priorBrief.method}｜结论:${article.priorBrief.finding}`
        : "";
      lines.push(`- [${article.id}] ${article.title} ｜ ${article.journal} ｜ ${article.displayDate} ｜ ${head}${brief}`);
      for (const keyword of String(article.keywords || "").split(/;|；/).map((t) => t.trim().toLowerCase()).filter(Boolean)) {
        keywordFreq.set(keyword, (keywordFreq.get(keyword) || 0) + 1);
      }
    }
    const topKeywords = [...keywordFreq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([keyword, n]) => `${keyword}(${n})`).join(", ");
    if (topKeywords) lines.push(`  ▸ 高频关键词：${topKeywords}`);
  }
  const text = lines.join("\n");
  if (args.out) {
    writeFileSync(args.out, text, "utf8");
    console.log(`compact out=${args.out} chars=${text.length}`);
  } else {
    console.log(text);
  }
}

main();
