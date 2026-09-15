// 关键词 / 摘要来源体检：在**当前主机**上跑一遍真实链路，报每个数据源的可用性、
// 单篇补全耗时与命中率。
//
// 为什么需要它：各数据源是按出口 IP 记账与限流的（OpenAlex 按日额度、Semantic
// Scholar 共享池、Scopus 按 key）。开发机的结果不能代表生产机，所以换一台主机、
// 或者换了密钥之后，都要在这里复测一次。
//
// 用法（远端）：
//   .runtime\node\node.exe scripts\probe-metadata-sources.mjs [样本数] [期刊名关键字]
//
// 只读：只调用外部接口与本地 SELECT，不写数据库、不改配置。

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { config } from "../server/config.js";
import { crawlArticleDetails, internals as crawlerInternals } from "../server/crawler.js";
import { fetchElsevierArticleDetails, fetchScopusArticleDetails } from "../server/elsevier.js";
import { articlePlatform } from "../server/publishers.js";
import { resolveDataDirectory } from "../server/paths.js";

const sampleSize = Math.max(1, Math.min(30, Number(process.argv[2]) || 8));
const journalFilter = process.argv[3] || "";
const has = (value) => String(value || "").trim().length > 0;
const short = (value, width = 52) => (has(value) ? String(value).replace(/\s+/g, " ").slice(0, width) : "—");

console.log("== 元数据来源体检 ==");
console.log(`crawlerTimeout   : ${config.crawlerTimeoutMs} ms`);
console.log(`IEEE_API_KEY     : ${config.ieeeApiKey ? "已配置" : "未配置"}`);
console.log(`ELSEVIER_API_KEY : ${config.elsevierApiKey ? "已配置" : "未配置"}`);
console.log(`OPENALEX_API_KEY : ${config.openAlexApiKey ? "已配置" : "未配置"}`);
console.log(`CROSSREF_MAILTO  : ${config.crossrefMailto ? "已配置" : "未配置"}`);
console.log(`网页兜底         : ${config.semanticScholarWebFallbackEnabled ? "开启" : "关闭"}`);
console.log(`数据源           : ${config.publicDataSources.join(", ")}\n`);

const db = new DatabaseSync(path.join(resolveDataDirectory(), "literature.sqlite"), { readOnly: true });
db.function("is_non_research_title", { deterministic: true, varargs: true }, () => 0);
const rows = db.prepare(`
  SELECT id, title, journal, doi, abstract, keywords, url, external_id
  FROM articles
  WHERE (length(trim(coalesce(keywords, ''))) = 0 OR length(trim(coalesce(abstract, ''))) = 0)
    AND length(trim(coalesce(title, ''))) > 0
  ORDER BY id DESC
  LIMIT ?
`).all(sampleSize * 12)
  .filter((row) => (journalFilter ? String(row.journal).includes(journalFilter) : true))
  .filter((row) => /[\u3400-\u9fff]/u.test(String(row.title || "")) ? articlePlatform(row) === "wanfang" : true)
  .slice(0, sampleSize);

if (!rows.length) {
  console.log("没有取到符合条件的样本。");
  process.exit(0);
}

async function timed(label, fn) {
  const startedAt = Date.now();
  try {
    const value = await fn();
    return { label, ms: Date.now() - startedAt, ok: true, value };
  } catch (error) {
    return { label, ms: Date.now() - startedAt, ok: false, error: error?.message || String(error) };
  }
}

console.log(`样本 ${rows.length} 篇，逐篇跑真实补全链路\n${"=".repeat(96)}`);
const totals = new Map();
let abstractFilled = 0;
let keywordFilled = 0;
let elapsedTotal = 0;

for (const article of rows) {
  const platform = articlePlatform(article);
  const startedAt = Date.now();
  let detail = null;
  let error = null;
  try {
    detail = await crawlArticleDetails(article, { fields: ["abstract", "keywords"], onDiagnostics: () => {} });
  } catch (failure) {
    detail = failure.details || null;
    error = failure.message;
  }
  const elapsed = Date.now() - startedAt;
  elapsedTotal += elapsed;

  const gotAbstract = has(detail?.abstract) && !has(article.abstract);
  const gotKeywords = has(detail?.keywords) && !has(article.keywords);
  if (gotAbstract) abstractFilled += 1;
  if (gotKeywords) keywordFilled += 1;

  console.log(`#${article.id} ${platform.padEnd(8)} ${short(article.journal, 30)}  ${String(elapsed).padStart(6)}ms`);
  console.log(`   摘要 ${gotAbstract ? "＋补到" : has(article.abstract) ? "原有" : "未补到"}   关键词 ${gotKeywords ? "＋补到" : has(article.keywords) ? "原有" : "未补到"}`);
  if (has(detail?.keywords)) console.log(`   关键词内容: ${short(detail.keywords, 110)}`);
  if (error) console.log(`   备注: ${short(error, 100)}`);
}

console.log(`${"=".repeat(96)}\n== 逐源可用性（取第一份带 DOI 的样本）==`);
const probe = rows.find((row) => has(row.doi));
if (probe) {
  const { fetchOpenAlexDetails, fetchCrossrefDetails, fetchSemanticScholarDetails } = crawlerInternals;
  const probes = [
    ["ElsevierArticle", () => fetchElsevierArticleDetails(probe.doi)],
    ["ScopusAbstract", () => fetchScopusArticleDetails(probe.doi)],
    ["OpenAlex", () => fetchOpenAlexDetails(probe.doi)],
    ["Crossref", () => fetchCrossrefDetails(probe.doi)],
    ["SemanticScholar", () => fetchSemanticScholarDetails(probe.doi)]
  ];
  console.log(`DOI: ${probe.doi}  [${probe.journal}]`);
  for (const [label, fn] of probes) {
    const result = await timed(label, fn);
    const bucket = totals.get(label) || { n: 0, ok: 0, ms: 0 };
    bucket.n += 1;
    bucket.ms += result.ms;
    if (result.ok) {
      bucket.ok += 1;
      const value = result.value || {};
      console.log(`  ${label.padEnd(16)} ${String(result.ms).padStart(6)}ms  摘要 ${has(value.abstract) ? "√" : "×"}  关键词 ${has(value.keywords) ? "√" : "×"}  ${short(value.keywords, 70)}`);
    } else {
      console.log(`  ${label.padEnd(16)} ${String(result.ms).padStart(6)}ms  ✖ ${short(result.error, 70)}`);
    }
    totals.set(label, bucket);
  }
}

console.log(`${"=".repeat(96)}\n== 汇总 ==`);
console.log(`摘要补到 ${abstractFilled}/${rows.length}   关键词补到 ${keywordFilled}/${rows.length}   平均 ${Math.round(elapsedTotal / rows.length)} ms/篇`);
for (const [label, bucket] of [...totals.entries()].sort((a, b) => b[1].ms / b[1].n - a[1].ms / a[1].n)) {
  console.log(`${label.padEnd(16)} n=${bucket.n} 成功 ${bucket.ok} 平均 ${Math.round(bucket.ms / bucket.n)}ms`);
}
