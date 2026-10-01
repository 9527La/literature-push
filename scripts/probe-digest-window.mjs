// 远端只读：核对摘要条数为什么这么多 —— published_at vs first_seen_at。
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(process.argv[2] || "E:\\SC\\文献推送");
const days = Number(process.argv[3] || 7);
const db = new DatabaseSync(path.join(root, "data", "literature.sqlite"), { readOnly: true });

const since = new Date();
since.setDate(since.getDate() - days);
const sinceDate = since.toISOString().slice(0, 10);
console.log(`统计窗口：${sinceDate} 起（近 ${days} 天）\n`);

const EXCLUDE = `
  lower(title) NOT LIKE '%information%' AND lower(title) NOT LIKE '%table of contents%'
  AND lower(title) NOT LIKE '%blank page%' AND lower(title) NOT LIKE 'correction to%'
  AND lower(title) NOT LIKE '%publication information%' AND lower(title) NOT LIKE '%front cover%'
  AND lower(title) NOT LIKE '%back cover%'`;

const one = (sql, params) => db.prepare(sql).get(...(params || [])).n;

console.log("=== 各口径命中的文章数（全部期刊）===");
console.log(`  现口径（published_at OR first_seen_at）: ${one(`SELECT COUNT(*) n FROM articles WHERE ((published_at IS NOT NULL AND published_at<>'' AND substr(published_at,1,10)>=?) OR (first_seen_at IS NOT NULL AND first_seen_at<>'' AND substr(first_seen_at,1,10)>=?)) AND ${EXCLUDE}`, [sinceDate, sinceDate])}`);
console.log(`  仅 published_at                      : ${one(`SELECT COUNT(*) n FROM articles WHERE published_at IS NOT NULL AND published_at<>'' AND substr(published_at,1,10)>=? AND ${EXCLUDE}`, [sinceDate])}`);
console.log(`  仅 first_seen_at                     : ${one(`SELECT COUNT(*) n FROM articles WHERE first_seen_at IS NOT NULL AND first_seen_at<>'' AND substr(first_seen_at,1,10)>=? AND ${EXCLUDE}`, [sinceDate])}`);

console.log("\n=== published_at 的格式分布（全库）===");
for (const row of db.prepare(`
  SELECT CASE
    WHEN published_at IS NULL OR published_at='' THEN 'NULL/空'
    WHEN length(published_at) >= 10 THEN 'YYYY-MM-DD 或更长'
    WHEN length(published_at) = 7 THEN 'YYYY-MM'
    WHEN length(published_at) = 4 THEN 'YYYY'
    ELSE '其他(' || length(published_at) || ')'
  END AS fmt, COUNT(*) AS n
  FROM articles GROUP BY fmt ORDER BY n DESC`).all()) {
  console.log(`  ${row.fmt}: ${row.n}`);
}

console.log("\n=== published_at 样例（近 30 天内、长度异常者）===");
for (const row of db.prepare(`
  SELECT id, published_at, first_seen_at, journal FROM articles
  WHERE published_at IS NOT NULL AND published_at <> '' AND length(published_at) < 10
  ORDER BY id DESC LIMIT 10`).all()) {
  console.log(`  #${row.id}  published_at="${row.published_at}"  first_seen="${row.first_seen_at}"  ${String(row.journal).slice(0, 40)}`);
}

console.log("\n=== 「入库时间在窗口内、但出版日期在窗口外」的文章（条数爆炸的来源）===");
console.log(`  ${one(`SELECT COUNT(*) n FROM articles WHERE substr(first_seen_at,1,10)>=? AND (published_at IS NULL OR published_at='' OR substr(published_at,1,10)<?) AND ${EXCLUDE}`, [sinceDate, sinceDate])} 条`);
console.log("\n  按出版年月分组（前 15）：");
for (const row of db.prepare(`
  SELECT substr(published_at,1,7) AS ym, COUNT(*) AS n FROM articles
  WHERE substr(first_seen_at,1,10)>=? AND (published_at IS NULL OR published_at='' OR substr(published_at,1,10)<?) AND ${EXCLUDE}
  GROUP BY ym ORDER BY n DESC LIMIT 15`).all(sinceDate, sinceDate)) {
  console.log(`    ${row.ym || "(无出版日期)"}: ${row.n}`);
}

console.log("\n=== 主账户订阅的 17 种期刊在两种口径下的条数 ===");
const journals = db.prepare("SELECT DISTINCT journal FROM articles ORDER BY journal").all().map((r) => r.journal);
for (const name of journals.slice(0, 20)) {
  const a = one(`SELECT COUNT(*) n FROM articles WHERE journal=? AND ((published_at IS NOT NULL AND published_at<>'' AND substr(published_at,1,10)>=?) OR (substr(first_seen_at,1,10)>=?)) AND ${EXCLUDE}`, [name, sinceDate, sinceDate]);
  const b = one(`SELECT COUNT(*) n FROM articles WHERE journal=? AND published_at IS NOT NULL AND published_at<>'' AND substr(published_at,1,10)>=? AND ${EXCLUDE}`, [name, sinceDate]);
  console.log(`  ${String(name).slice(0, 52).padEnd(52)} 现口径 ${String(a).padStart(5)}  仅出版日期 ${String(b).padStart(5)}`);
}
db.close();
