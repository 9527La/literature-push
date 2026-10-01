/**
 * 只读诊断（2026-09-24）：「文献日期统计」的语义混乱程度盘点。
 *
 * 目的不是修 bug，而是把「同一批数据在不同统计口径下差多少」量化出来，
 * 供上层决定统一口径方案。全程 readOnly，不改任何数据。
 *
 * 用法（远端）：& 'E:\SC\文献推送\.runtime\node\node.exe' 'scripts\diag-date-statistics.mjs'
 */
import { DatabaseSync } from "node:sqlite";
import { isNonResearchTitle } from "../server/utils.js";

const DATA = "E:/SC/文献推送/data/";
const db = new DatabaseSync(DATA + "literature.sqlite", { readOnly: true });
db.function("is_non_research_title", { deterministic: true }, (v) => (isNonResearchTitle(v) ? 1 : 0));
const all = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);
const n = (sql, ...args) => Number(one(sql, ...args)?.c || 0);

// 生产代码里的统一口径（server/db.js#effectiveDateSql）
const effective = (alias) => `datetime(CASE
    WHEN datetime(${alias}.published_at) IS NULL THEN COALESCE(NULLIF(${alias}.first_seen_at,''), ${alias}.fetched_at)
    WHEN datetime(${alias}.published_at) > datetime('now') THEN COALESCE(NULLIF(${alias}.first_seen_at,''), ${alias}.fetched_at)
    ELSE ${alias}.published_at END)`;
const display = (alias) => `substr(${effective(alias)}, 1, 10)`;

const RESEARCH = "is_non_research_title(title) = 0";

console.log("### 0. 环境");
console.log(`  sqlite now()            = ${one("SELECT datetime('now') AS c").c}   （UTC）`);
console.log(`  sqlite date('now')      = ${one("SELECT date('now') AS c").c}`);
console.log(`  sqlite date('now','+8h')= ${one("SELECT date('now','+8 hours') AS c").c}   （北京日期）`);
console.log(`  机器本地时间            = ${new Date().toString()}`);

console.log("\n### 1. 三个时间字段的可用性");
const total = n("SELECT COUNT(*) AS c FROM articles");
const research = n(`SELECT COUNT(*) AS c FROM articles WHERE ${RESEARCH}`);
console.log(`  总文献 ${total}，其中非研究性标题 ${total - research}（统计一律排除后者）`);
console.log(`  published_at 空/空白    = ${n("SELECT COUNT(*) AS c FROM articles WHERE published_at IS NULL OR length(trim(published_at))=0")}`);
console.log(`  first_seen_at 空/空白   = ${n("SELECT COUNT(*) AS c FROM articles WHERE first_seen_at IS NULL OR length(trim(first_seen_at))=0")}`);
console.log(`  fetched_at 空           = ${n("SELECT COUNT(*) AS c FROM articles WHERE fetched_at IS NULL OR length(trim(fetched_at))=0")}`);

console.log("\n### 2. published_at 到底装了什么（形态普查）");
const shape = all(`SELECT
    CASE
      WHEN published_at IS NULL OR length(trim(published_at))=0 THEN 'empty'
      WHEN published_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN 'YYYY-MM-DD…'
      WHEN published_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' THEN 'YYYY-MM'
      WHEN published_at GLOB '[0-9][0-9][0-9][0-9]' THEN 'YYYY'
      ELSE '其它'
    END AS kind, COUNT(*) AS c, MIN(published_at) AS lo, MAX(published_at) AS hi
  FROM articles GROUP BY kind ORDER BY c DESC`);
for (const r of shape) console.log(`  ${r.kind.padEnd(12)} ${String(r.c).padStart(5)}  例：${r.lo} … ${r.hi}`);
const weird = all(`SELECT published_at, COUNT(*) AS c FROM articles
  WHERE published_at IS NOT NULL AND length(trim(published_at))>0
    AND published_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  GROUP BY published_at ORDER BY c DESC LIMIT 10`);
if (weird.length) { console.log("  非标准形态样本："); for (const r of weird) console.log(`    "${r.published_at}"  ×${r.c}`); }

console.log("\n### 3. 未来日期（提前访问 / 未来卷期）");
const fut = one(`SELECT COUNT(*) AS c, MIN(published_at) AS lo, MAX(published_at) AS hi FROM articles
  WHERE ${RESEARCH} AND datetime(published_at) > datetime('now')`);
console.log(`  条数 ${fut.c}（${(fut.c / research * 100).toFixed(1)}% 的研究性文献）`);
console.log(`  区间 ${String(fut.lo).slice(0, 10)} … ${String(fut.hi).slice(0, 10)}`);
console.log("  未来日期最集中的取值：");
for (const r of all(`SELECT substr(published_at,1,10) AS d, COUNT(*) AS c FROM articles
    WHERE ${RESEARCH} AND datetime(published_at) > datetime('now') GROUP BY d ORDER BY c DESC LIMIT 8`)) {
  console.log(`    ${r.d}  ${String(r.c).padStart(4)} 篇`);
}
console.log("  涉及刊（前 8）：");
for (const r of all(`SELECT journal, COUNT(*) AS c FROM articles
    WHERE ${RESEARCH} AND datetime(published_at) > datetime('now') GROUP BY journal ORDER BY c DESC LIMIT 8`)) {
  console.log(`    ${String(r.c).padStart(4)}  ${r.journal}`);
}

console.log("\n### 4. 同一个「最近 N 天」，四种口径各是多少");
for (const days of [7, 30]) {
  const unified = n(`SELECT COUNT(*) AS c FROM articles WHERE ${RESEARCH} AND ${display("articles")} >= date('now','-${days} day') AND ${display("articles")} <= date('now')`);
  const rawPub = n(`SELECT COUNT(*) AS c FROM articles WHERE ${RESEARCH} AND substr(published_at,1,10) >= date('now','-${days} day') AND substr(published_at,1,10) <= date('now')`);
  const rawSeen = n(`SELECT COUNT(*) AS c FROM articles WHERE ${RESEARCH} AND substr(first_seen_at,1,10) >= date('now','-${days} day')`);
  const fallback = n(`SELECT COUNT(*) AS c FROM articles WHERE ${RESEARCH} AND ${display("articles")} >= date('now','-${days} day') AND ${display("articles")} <= date('now') AND (datetime(published_at) IS NULL OR datetime(published_at) > datetime('now'))`);
  console.log(`  最近 ${days} 天：统一口径=${unified}  纯 published_at=${rawPub}  纯 first_seen_at=${rawSeen}`);
  console.log(`            统一口径里靠「入库时间」兜底的 = ${fallback}（占 ${(fallback / (unified || 1) * 100).toFixed(0)}%），真正按出版日期进窗口的 = ${unified - fallback}`);
}

console.log("\n### 5. 窗口长度 off-by-one：「最近 N 天」实际含 N+1 个日期");
for (const days of [7, 30]) {
  const inclusive = n(`SELECT COUNT(*) AS c FROM articles WHERE ${RESEARCH} AND ${display("articles")} >= date('now','-${days} day') AND ${display("articles")} <= date('now')`);
  const exact = n(`SELECT COUNT(*) AS c FROM articles WHERE ${RESEARCH} AND ${display("articles")} >= date('now','-${days - 1} day') AND ${display("articles")} <= date('now')`);
  console.log(`  最近 ${days} 天：现实现（-${days}..now，共 ${days + 1} 个日期）=${inclusive}   真正的 ${days} 个日期（-${days - 1}..now）=${exact}   差 ${inclusive - exact}`);
}

console.log("\n### 6. 时区：库里存 UTC，统计按 UTC 日期切，北京日期会偏移");
const shifted = n(`SELECT COUNT(*) AS c FROM articles WHERE date(first_seen_at, '+8 hours') <> substr(first_seen_at,1,10)`);
console.log(`  first_seen_at 的北京日期 ≠ UTC 日期 的记录 = ${shifted} 篇（${(shifted / total * 100).toFixed(1)}%）`);
for (const r of all(`SELECT substr(first_seen_at,1,10) AS d, COUNT(*) AS c FROM articles
    WHERE date(first_seen_at, '+8 hours') <> substr(first_seen_at,1,10)
    GROUP BY d ORDER BY d DESC LIMIT 5`)) {
  console.log(`    ${r.d}（UTC）  ${r.c} 篇，其北京日期为次日`);
}
console.log(`  影响：北京时间 00:00–08:00 之间入库的文献，会被算进「前一天」`);
const lateNight = n(`SELECT COUNT(*) AS c FROM articles WHERE CAST(substr(first_seen_at,12,2) AS INTEGER) >= 16`);
console.log(`  即 UTC 16:00 之后入库（= 北京次日 00:00 后）的记录 = ${lateNight} 篇`);

console.log("\n### 7. 排序口径：首页「最新文献」前 50 条里有多少是提前访问");
const top50 = all(`SELECT ${display("articles")} AS d,
    CASE WHEN datetime(published_at) IS NULL OR datetime(published_at) > datetime('now') THEN 'early' ELSE 'formal' END AS kind
  FROM articles WHERE ${RESEARCH} ORDER BY ${effective("articles")} DESC, id DESC LIMIT 50`);
const early = top50.filter((r) => r.kind === "early").length;
console.log(`  前 50 条中「提前访问（日期实际取入库时间）」= ${early} 条，正式出版 = ${50 - early} 条`);
const top50raw = all(`SELECT substr(published_at,1,10) AS d FROM articles
  WHERE ${RESEARCH} AND length(trim(published_at))>0 ORDER BY datetime(published_at) DESC LIMIT 5`);
console.log(`  若直接按 published_at 排序，前 5 条日期 = ${top50raw.map((r) => r.d).join(", ")}（全是未来日期）`);

console.log("\n### 8. 历史补录：出版日期远早于入库时间");
for (const gap of [30, 90, 365]) {
  const c = n(`SELECT COUNT(*) AS c FROM articles WHERE ${RESEARCH}
    AND length(trim(published_at))>0 AND julianday(first_seen_at) - julianday(published_at) > ${gap}`);
  console.log(`  入库时间比出版日期晚 ${gap} 天以上 = ${c} 篇`);
}
console.log(`  最早/最晚入库 = ${one("SELECT MIN(substr(first_seen_at,1,10)) AS c FROM articles").c} / ${one("SELECT MAX(substr(first_seen_at,1,10)) AS c FROM articles").c}`);
console.log(`  最早/最晚出版 = ${one("SELECT MIN(substr(published_at,1,10)) AS c FROM articles WHERE length(trim(published_at))>0").c} / ${one("SELECT MAX(substr(published_at,1,10)) AS c FROM articles WHERE length(trim(published_at))>0").c}`);

db.close();
