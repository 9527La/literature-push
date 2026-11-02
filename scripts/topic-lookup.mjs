#!/usr/bin/env node
/**
 * topic-lookup.mjs —— 按 id 从候选池里取标题+摘要（选题细选用）
 *
 * 背景：全库候选池 2000+ 条，带摘要的 topic-candidates.json 有好几 MB，
 * 会话里整份读不动。聚类粗筛后，只需要看某几个簇内几十篇的摘要，
 * 用本脚本按 id 精确取，避免把整个文件塞进上下文。
 *
 * 用法：
 *   node scripts/topic-lookup.mjs --ids 158889,156303,158857
 *   node scripts/topic-lookup.mjs --ids 158889 --chars 400
 *   node scripts/topic-lookup.mjs --file data/wechat-topics/2026-10-28.json   # 取该期所有 articleIds
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POOL = resolve(root, "data", "topic-candidates.json");

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? "" : argv[i + 1]; };

let ids = String(flag("--ids") || "").split(",").map((s) => Number(s.trim())).filter(Boolean);
const chars = Number(flag("--chars")) || 300;
const fromFile = flag("--file");

if (fromFile) {
  const p = resolve(process.cwd(), fromFile);
  if (!existsSync(p)) { console.error(`找不到 ${p}`); process.exit(2); }
  const issue = JSON.parse(readFileSync(p, "utf8"));
  const collect = (arr) => { for (const x of arr || []) if (Number.isFinite(Number(x))) ids.push(Number(x)); };
  if (Array.isArray(issue.groups)) issue.groups.forEach((g) => collect(g.articleIds));
  if (Array.isArray(issue.papers)) issue.papers.forEach((x) => collect([x.id]));
}

if (!ids.length) { console.error("用法: node scripts/topic-lookup.mjs --ids 1,2,3 [--chars 300]"); process.exit(2); }
if (!existsSync(POOL)) { console.error(`候选池不存在：${POOL}（先跑 export-topic-candidates.mjs）`); process.exit(2); }

const pool = JSON.parse(readFileSync(POOL, "utf8"));
const byId = new Map(pool.articles.map((a) => [a.id, a]));

for (const id of ids) {
  const a = byId.get(id);
  if (!a) { console.log(`— ${id} 不在候选池（可能属于被排除的方向）`); continue; }
  const abs = String(a.abstract || "").replace(/\s+/g, " ").trim();
  console.log(`\n[${id}] ${a.title}`);
  console.log(`  ${a.journal} · ${a.direction} · ${a.seen}${a.hasDeep ? " · 已有创新点" : ""}`);
  console.log(`  ${abs ? (abs.length > chars ? abs.slice(0, chars) + "…" : abs) : "（无摘要）"}`);
}
