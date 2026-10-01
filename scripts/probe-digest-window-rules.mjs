// 远端只读：对比几种候选口径在近 N 天的命中条数，给改口径提供真实数字。
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(process.argv[2] || "E:\\SC\\文献推送");
const db = new DatabaseSync(path.join(root, "data", "literature.sqlite"), { readOnly: true });
const days = Number(process.argv[3] || 7);

const today = new Date().toISOString().slice(0, 10);
const since = new Date();
since.setDate(since.getDate() - days);
const sinceDate = since.toISOString().slice(0, 10);

const EXCLUDE = `
  lower(title) NOT LIKE '%information%' AND lower(title) NOT LIKE '%table of contents%'
  AND lower(title) NOT LIKE '%blank page%' AND lower(title) NOT LIKE 'correction to%'
  AND lower(title) NOT LIKE '%publication information%' AND lower(title) NOT LIKE '%front cover%'
  AND lower(title) NOT LIKE '%back cover%'`;
const P = "published_at IS NOT NULL AND published_at <> ''";
const F = "first_seen_at IS NOT NULL AND first_seen_at <> ''";

const n = (where, params = {}) => db.prepare(
  `SELECT COUNT(*) n FROM articles WHERE ${where} AND ${EXCLUDE}`
).get(params).n;

console.log(`窗口 ${sinceDate} ~ ${today}（近 ${days} 天，全库 17 刊）\n`);
const rules = [
  ["① 现口径：出版日期 OR 入库时间", `((${P} AND substr(published_at,1,10)>=@s) OR (${F} AND substr(first_seen_at,1,10)>=@s))`, { s: sinceDate }],
  ["② 只按出版日期 >= 窗口起点", `(${P} AND substr(published_at,1,10)>=@s)`, { s: sinceDate }],
  ["③ 只按出版日期落在窗口内（不含未来）", `(${P} AND substr(published_at,1,10)>=@s AND substr(published_at,1,10)<=@t)`, { s: sinceDate, t: today }],
  ["④ 只按入库时间（现行 SQL 的另一半）", `(${F} AND substr(first_seen_at,1,10)>=@s)`, { s: sinceDate }],
  ["⑤ 出版日期在窗口内 OR (出版日期在未来 AND 入库在窗口内)", `((${P} AND substr(published_at,1,10)>=@s AND substr(published_at,1,10)<=@t) OR (${P} AND substr(published_at,1,10)>@t AND ${F} AND substr(first_seen_at,1,10)>=@s))`, { s: sinceDate, t: today }],
  ["⑥ ⑤ 再把无出版日期的剔除", `(${P} AND ((substr(published_at,1,10)>=@s AND substr(published_at,1,10)<=@t) OR (substr(published_at,1,10)>@t AND ${F} AND substr(first_seen_at,1,10)>=@s)))`, { s: sinceDate, t: today }]
];
for (const [label, where, params] of rules) {
  console.log(`  ${label.padEnd(48)} ${String(n(where, params)).padStart(5)} 篇`);
}

console.log("\n=== 规则⑤ 按期刊拆分 ===");
for (const row of db.prepare(`
  SELECT journal, COUNT(*) n FROM articles
  WHERE (${P} AND ((substr(published_at,1,10)>=@s AND substr(published_at,1,10)<=@t)
     OR (substr(published_at,1,10)>@t AND ${F} AND substr(first_seen_at,1,10)>=@s)))
    AND ${EXCLUDE}
  GROUP BY journal ORDER BY n DESC`).all({ s: sinceDate, t: today })) {
  console.log(`  ${String(row.journal).slice(0, 52).padEnd(52)} ${String(row.n).padStart(5)}`);
}

console.log("\n=== 「出版日期在未来」的文章（提前出版）===");
for (const row of db.prepare(`
  SELECT substr(published_at,1,10) d, COUNT(*) n FROM articles
  WHERE ${P} AND substr(published_at,1,10)>@t AND ${EXCLUDE}
  GROUP BY d ORDER BY n DESC LIMIT 10`).all({ t: today })) {
  console.log(`  ${row.d}: ${row.n} 篇`);
}
console.log(`  合计 ${n(`${P} AND substr(published_at,1,10)>@t`, { t: today })} 篇`);
db.close();
