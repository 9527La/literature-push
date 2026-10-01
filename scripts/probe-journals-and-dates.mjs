// 只读探针：核对「管理中心期刊分布」里出现的非目录期刊，以及 published_at 的分布形态。
// 用法：node scripts/probe-journals-and-dates.mjs [sqlitePath]
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { projectRoot } from "../server/paths.js";
import { DEFAULT_JOURNALS } from "../server/journals.js";

const dbPath = process.argv[2] || path.join(projectRoot, "data", "literature.sqlite");
const db = new DatabaseSync(dbPath, { readOnly: true });

const catalog = new Set(DEFAULT_JOURNALS.map((journal) => journal.name));
console.log(`=== 期刊目录（${catalog.size} 刊）===`);
for (const journal of DEFAULT_JOURNALS) console.log(`  ${journal.group.padEnd(9)} ${journal.name}`);

console.log("\n=== 库内 journal 分布（原始字符串）===");
const rows = db.prepare(`
  SELECT COALESCE(NULLIF(TRIM(journal), ''), '<空>') AS journal, COUNT(*) AS n
  FROM articles GROUP BY 1 ORDER BY n DESC
`).all();
let inCatalog = 0;
let outCatalog = 0;
for (const row of rows) {
  const hit = catalog.has(row.journal);
  if (hit) inCatalog += Number(row.n); else outCatalog += Number(row.n);
  if (!hit) console.log(`  ❌ 非目录  ${String(row.n).padStart(6)}  ${row.journal}`);
}
console.log(`  目录内合计 ${inCatalog} 篇 / 非目录合计 ${outCatalog} 篇 / 共 ${inCatalog + outCatalog} 篇`);

console.log("\n=== published_at 形态 ===");
console.log(db.prepare(`
  SELECT CASE
      WHEN published_at IS NULL OR published_at = '' THEN 'NULL/空'
      WHEN length(published_at) >= 10 THEN 'YYYY-MM-DD 或更长'
      WHEN length(published_at) = 7 THEN 'YYYY-MM'
      WHEN length(published_at) = 4 THEN 'YYYY'
      ELSE '其他(' || length(published_at) || ')'
    END AS shape, COUNT(*) AS n
  FROM articles GROUP BY 1 ORDER BY n DESC
`).all().map((r) => `  ${String(r.n).padStart(6)}  ${r.shape}`).join("\n"));

const today = new Date().toISOString().slice(0, 10);
const stats = db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN published_at IS NOT NULL AND published_at <> '' AND substr(published_at, 1, 10) > :today THEN 1 ELSE 0 END) AS future,
    SUM(CASE WHEN datetime(published_at) IS NULL THEN 1 ELSE 0 END) AS unparsable,
    SUM(CASE WHEN (first_seen_at IS NULL OR first_seen_at = '') AND (fetched_at IS NULL OR fetched_at = '') THEN 1 ELSE 0 END) AS no_first_seen
  FROM articles
`).get({ today });
console.log("\n=== 关键计数 ===");
console.log(`  总条数               ${stats.total}`);
console.log(`  出版日期在未来(提前访问) ${stats.future}`);
console.log(`  出版日期不可解析(datetime NULL) ${stats.unparsable}`);
console.log(`  无 first_seen/fetched   ${stats.no_first_seen}`);

console.log("\n=== 未来出版日期样例（按日期倒序 12 条）===");
for (const row of db.prepare(`
  SELECT id, journal, published_at, first_seen_at, fetched_at FROM articles
  WHERE published_at IS NOT NULL AND published_at <> '' AND substr(published_at, 1, 10) > :today
  ORDER BY published_at DESC LIMIT 12
`).all({ today })) {
  console.log(`  ${row.published_at}  first_seen=${row.first_seen_at || "-"}  #${row.id}  ${String(row.journal || "").slice(0, 40)}`);
}

db.close();
