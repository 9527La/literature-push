// 语义学者（Semantic Scholar）网页兜底通道的可用性与耗时体检。
//
// 背景：`server/semantic-scholar-web.js` 是最后一道摘要兜底，每篇要新起一个
// headless 浏览器，并受 `SEMANTIC_SCHOLAR_WEB_REQUEST_INTERVAL_MS`（默认 12 秒）
// 全局串行节流。实测在开发机上成功率是 0/6、单篇 34–61 秒，纯粹是等待。
// 但生产机是另一台主机，出口 IP 与浏览器环境都不同，不能凭开发机的结论替它做决定。
// 这个脚本就用**生产机上真实的缺摘要文献**去跑一遍，用数据决定是否关闭该通道。
//
// 用法（远端）：
//   .runtime\node\node.exe scripts\probe-semantic-scholar-web.mjs [样本数]
//
// 只读：不写数据库、不改任何配置。

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { config } from "../server/config.js";
import { fetchSemanticScholarWebDetails, internals as ssInternals } from "../server/semantic-scholar-web.js";
import { resolveDataDirectory } from "../server/paths.js";

const sampleSize = Math.max(1, Math.min(20, Number(process.argv[2]) || 3));

console.log("== Semantic Scholar 网页兜底体检 ==");
console.log(`enabled          : ${config.semanticScholarWebFallbackEnabled}`);
console.log(`interval         : ${ssInternals.intervalMs()} ms`);
console.log(`pageTimeout      : ${config.semanticScholarWebTimeoutMs} ms`);
console.log(`browser          : ${ssInternals.browserExecutablePath() || "(未找到 Edge/Chrome)"}`);
console.log(`crawlerTimeout   : ${config.crawlerTimeoutMs} ms\n`);

if (!config.semanticScholarWebFallbackEnabled) {
  console.log("该通道已在配置中关闭，无需体检。");
  process.exit(0);
}

let articles = [];
try {
  const db = new DatabaseSync(path.join(resolveDataDirectory(), "literature.sqlite"), { readOnly: true });
  articles = db.prepare(`
    SELECT id, title, journal, doi, abstract
    FROM articles
    WHERE length(trim(coalesce(abstract, ''))) = 0
      AND length(trim(coalesce(title, ''))) > 0
    ORDER BY COALESCE(first_seen_at, fetched_at) DESC
    LIMIT ?
  `).all(sampleSize * 8)
    // 中文标题不会被 Semantic Scholar 的英文检索命中，先排除以免白等。
    .filter((row) => !/[\u3400-\u9fff]/u.test(String(row.title || "")))
    .slice(0, sampleSize);
} catch (error) {
  console.log(`读取数据库失败（${error.message}），改用内置样题。`);
}

if (!articles.length) {
  articles = [{ id: 0, title: "Risk-Aware Economic Scheduling for Hydrogen-Enabled Building Energy Systems", journal: "(内置样题)", doi: "" }];
}

let ok = 0;
let totalMs = 0;
const times = [];
for (const article of articles) {
  const startedAt = Date.now();
  let message = "";
  let abstractLength = 0;
  try {
    const detail = await fetchSemanticScholarWebDetails(article);
    abstractLength = String(detail?.abstract || "").length;
    if (abstractLength > 0) ok += 1;
    else message = "返回了结果但没有摘要";
  } catch (error) {
    message = error?.message || String(error);
  }
  const elapsed = Date.now() - startedAt;
  times.push(elapsed);
  totalMs += elapsed;
  console.log(`#${article.id} [${article.journal}]`);
  console.log(`   title    : ${String(article.title).slice(0, 70)}`);
  console.log(`   elapsed  : ${elapsed} ms`);
  console.log(`   result   : ${abstractLength > 0 ? `摘要 ${abstractLength} 字` : `失败 — ${message}`}\n`);
}

console.log("== 汇总 ==");
console.log(`成功 ${ok}/${articles.length}  平均 ${Math.round(totalMs / articles.length)} ms  最慢 ${Math.max(...times)} ms`);
console.log(ok === 0
  ? "结论：该通道在本机拿不到任何数据，建议 SEMANTIC_SCHOLAR_WEB_FALLBACK_ENABLED=false。"
  : "结论：该通道在本机可用，是否保留取决于你能接受的每篇耗时。");
